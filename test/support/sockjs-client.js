/*
 * test/support/sockjs-client.js
 *
 * Copyright (C) 2026 by Posit Software, PBC
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

// Just enough of a browser-side SockJS client to drive lib/proxy/sockjs.js
// from a test, using the native WebSocket transport.
//
// Only the outermost layer -- SockJS's own framing -- is handled here. The two
// layers Shiny Server adds on top are left to the caller, because they are
// what the tests are about:
//
// - Multiplexing ("<channel>|o|<url>", "<channel>|m|<data>",
//   "<channel>|c|<json>"), see lib/proxy/multiplex.js. Every message a test
//   sends or receives is a multiplex frame.
// - Robust reconnection ("<hex-id>#<payload>", ACK, CONTINUE), see
//   lib/proxy/robust-sockjs.js. RobustSession below implements the client side
//   of it, the way shiny-server-client's BufferedResendConnection does.
//
// SockJS server frames: "o" (open), "h" (heartbeat), 'a["msg", ...]' (one or
// more messages), 'c[code,"reason"]' (close). Client frames are JSON arrays of
// strings.

var crypto = require('crypto');
var WebSocket = require('faye-websocket');

/**
 * One SockJS session over a native WebSocket.
 *
 * @param {number} port - The Shiny Server port.
 * @param {string} sockjsPath - Everything before the SockJS server/session
 *   segments, e.g. "/myapp/__sockjs__" or "/myapp/__sockjs__/n=abc123".
 */
exports.SockJSTransport = SockJSTransport;
function SockJSTransport(port, sockjsPath) {
  var self = this;

  // SockJS wants "<server-id>/<session-id>/websocket" after its prefix. The
  // server id is meant for sticky load balancing and is ignored here.
  var session = crypto.randomBytes(8).toString('hex');
  this.url = 'ws://127.0.0.1:' + port + sockjsPath + '/000/' + session +
    '/websocket';

  this.$inbox = [];
  this.$waiters = [];

  /** Resolves to {code, reason} once SockJS closes the session. */
  this.closed_p = new Promise(function(resolve) {
    self.$resolveClosed = resolve;
  });

  this.opened_p = new Promise(function(resolve, reject) {
    self.$ws = new WebSocket.Client(self.url);

    self.$ws.on('message', function(event) {
      var frame = event.data;
      var type = frame.charAt(0);
      if (type === 'o') {
        resolve(self);
      } else if (type === 'a') {
        JSON.parse(frame.substring(1)).forEach(function(msg) {
          self.$deliver(msg);
        });
      } else if (type === 'c') {
        var args = JSON.parse(frame.substring(1));
        self.$resolveClosed({code: args[0], reason: args[1]});
      }
      // 'h' heartbeats are ignored.
    });

    self.$ws.on('close', function(event) {
      // A 'c' frame normally arrives first and has already settled closed_p
      // with the SockJS-level code, which is the one that matters; this only
      // fills in when the socket went away without one.
      self.$resolveClosed({code: event.code, reason: event.reason});
      reject(new Error('WebSocket closed before the SockJS open frame (code ' +
        event.code + ')'));
      self.$failWaiters(new Error('SockJS session closed (code ' +
        event.code + ')'));
    });
  });
}

(function() {
  /** Sends one message. */
  this.send = function(msg) {
    this.$ws.send(JSON.stringify([msg]));
  };

  /**
   * Resolves to the next message received, in arrival order.
   *
   * @param {number} [timeoutMs] - Defaults to 3000.
   */
  this.next_p = function(timeoutMs) {
    if (this.$inbox.length)
      return Promise.resolve(this.$inbox.shift());

    var self = this;
    timeoutMs = timeoutMs || 3000;
    return new Promise(function(resolve, reject) {
      var waiter = {resolve: resolve, reject: reject};
      waiter.timer = setTimeout(function() {
        self.$waiters.splice(self.$waiters.indexOf(waiter), 1);
        reject(new Error('No SockJS message within ' + timeoutMs + 'ms on ' +
          self.url));
      }, timeoutMs);
      self.$waiters.push(waiter);
    });
  };

  /** Closes the WebSocket cleanly, the way a browser tab would. */
  this.close = function() {
    this.$ws.close();
  };

  this.$deliver = function(msg) {
    var waiter = this.$waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
    } else {
      this.$inbox.push(msg);
    }
  };

  this.$failWaiters = function(err) {
    this.$waiters.splice(0).forEach(function(waiter) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    });
  };
}).call(SockJSTransport.prototype);

/**
 * Opens a plain (non-robust) SockJS session.
 *
 * @param {number} port - The Shiny Server port.
 * @param {string} appPath - The app's URL prefix, e.g. "/myapp/".
 * @returns {Promise} A promise of an open SockJSTransport.
 */
exports.connect_p = function(port, appPath) {
  return new SockJSTransport(port, appPath + '__sockjs__').opened_p;
};

/**
 * A robust session: one stable id that can outlive several transports, with
 * every payload tagged by a per-direction hex message id.
 *
 * @param {number} port - The Shiny Server port.
 * @param {string} appPath - The app's URL prefix, e.g. "/myapp/".
 */
exports.RobustSession = RobustSession;
function RobustSession(port, appPath) {
  this.port = port;
  this.appPath = appPath;
  this.id = crypto.randomBytes(8).toString('hex');
  /** The id our next outbound message gets. */
  this.outId = 0;
  /** The first inbound id not yet seen -- what we CONTINUE from. */
  this.inNext = 0;
  /** The current transport, or null before connect_p(). */
  this.transport = null;
  /** Every CONTINUE the server sent us, as the id it carried. */
  this.continuesReceived = [];
}

(function() {
  /**
   * Opens a transport. The first call asks for a new session ("n="); later
   * calls resume it ("o=") and send CONTINUE, as the client must do first
   * thing after every reconnect.
   */
  this.connect_p = function() {
    var resuming = this.transport !== null;
    var path = this.appPath + '__sockjs__/' + (resuming ? 'o=' : 'n=') + this.id;
    var self = this;
    return new SockJSTransport(this.port, path).opened_p.then(function(t) {
      self.transport = t;
      if (resuming)
        t.send('CONTINUE ' + formatId(self.inNext));
      return self;
    });
  };

  /** Sends one payload, tagged with the next outbound id. */
  this.send = function(msg) {
    this.transport.send(formatId(this.outId++) + '#' + msg);
  };

  /**
   * Resolves to the next tagged payload with the tag stripped. The server's
   * ACK and CONTINUE control messages are consumed and skipped.
   */
  this.next_p = function(timeoutMs) {
    var self = this;
    return this.transport.next_p(timeoutMs).then(function(msg) {
      var control = /^(ACK|CONTINUE) ([\dA-F]+)$/.exec(msg);
      if (control) {
        if (control[1] === 'CONTINUE')
          self.continuesReceived.push(parseInt(control[2], 16));
        return self.next_p(timeoutMs);
      }
      var m = /^([\dA-F]+)#([\s\S]*)$/.exec(msg);
      if (!m)
        throw new Error('Untagged message on a robust session: ' + msg);
      self.inNext = parseInt(m[1], 16) + 1;
      return m[2];
    });
  };

  this.close = function() {
    if (this.transport)
      this.transport.close();
  };
}).call(RobustSession.prototype);

function formatId(id) {
  return id.toString(16).toUpperCase();
}
