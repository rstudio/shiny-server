/*
 * test/integration/sockjs.js
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

// The SockJS path end to end: a browser-side SockJS session, through the
// upgrade handler (or the Express middleware, for the XHR fallback), the
// robust and multiplex layers, and a worker-side faye-websocket client, to a
// stand-in worker's WebSocket. Every Shiny session's traffic takes this route
// once the app page has loaded.
//
// See memory-bank/proxyLayer.md for the layering. Every message the tests send
// and receive is a multiplex frame ("<channel>|<method>|<payload>"); channel 0
// opened with an empty URL is the app's own session, as shiny-server-client
// does it.

var assert = require('assert');
var WebSocket = require('faye-websocket');
var testServer = require('../support/server');
var testConfig = require('../support/config');
var sockjsClient = require('../support/sockjs-client');
var errorcode = require('../../lib/proxy/errorcode');

var APP_FILES = {
  'site/myapp/server.R': '# not actually run\n',
  'site/myapp/ui.R': '# not actually run\n',
  'site/static/hello.html': '<h1>not an app</h1>'
};

/**
 * The stand-in app's WebSocket endpoint: echoes every message back with an
 * "echo:" prefix, except "crash", which drops the socket the way a dying R
 * process would. Each worker keeps its sockets in `websockets`, so a test can
 * also push a message unprompted, as a Shiny app does when an output changes.
 */
var WORKER = {
  onUpgrade: function(req, socket, head, worker) {
    var ws = new WebSocket(req, socket, head);
    worker.websockets = (worker.websockets || []).concat(ws);
    ws.on('message', function(event) {
      if (event.data === 'crash')
        socket.destroy();
      else
        ws.send('echo:' + event.data);
    });
  }
};

/** Polls `predicate` until it returns truthy or `timeoutMs` passes. */
function waitFor_p(predicate, description, timeoutMs) {
  timeoutMs = timeoutMs || 3000;
  var deadline = Date.now() + timeoutMs;
  return new Promise(function(resolve, reject) {
    (function poll() {
      if (predicate())
        return resolve();
      if (Date.now() > deadline)
        return reject(new Error('Timed out waiting for ' + description));
      setTimeout(poll, 10);
    })();
  });
}

function delay_p(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

/** The WebSocket upgrades the stand-in workers received. */
function upgrades(server) {
  return server.worker.requests().filter(function(r) {
    return r.headers.upgrade === 'websocket';
  });
}

/** Reads messages until one satisfies `predicate`; resolves to all of them. */
function readUntil_p(conn, predicate) {
  var seen = [];
  return (function next() {
    return conn.next_p().then(function(msg) {
      seen.push(msg);
      return predicate(msg) ? seen : next();
    });
  })();
}

function parseChannelClose(msg) {
  var m = /^0\|c\|(.*)$/.exec(msg);
  return m ? JSON.parse(m[1]) : null;
}

describe('sockjs', function() {
  var server;
  var clients;

  function start_p(configOpts) {
    return testServer.start_p(testConfig.siteDirConfig(configOpts), {
      files: APP_FILES,
      worker: WORKER
    })
    .then(function(s) { server = s; });
  }

  /** Remembers a client so afterEach can hang it up before shutdown. */
  function track(client) {
    clients.push(client);
    return client;
  }

  beforeEach(function() {
    clients = [];
  });

  afterEach(function() {
    // Server#$destroyConnections can't see upgraded sockets, so a client left
    // open here would stall shutdown_p() until mocha's timeout.
    clients.forEach(function(c) { c.close(); });
    var s = server;
    server = null;
    return s ? s.stop_p() : null;
  });

  describe('over a native WebSocket', function() {
    beforeEach(function() {
      return start_p();
    });

    it('relays messages in both directions, in order', function() {
      return sockjsClient.connect_p(server.port, '/myapp/').then(function(conn) {
        track(conn);
        // Sent back to back, before the worker-side WebSocket can possibly
        // have opened, so these also go through connectToApp's event queue.
        conn.send('0|o|');
        conn.send('0|m|one');
        conn.send('0|m|two');
        conn.send('0|m|three');
        return Promise.all([conn.next_p(), conn.next_p(), conn.next_p()]);
      })
      .then(function(msgs) {
        assert.deepStrictEqual(msgs,
          ['0|m|echo:one', '0|m|echo:two', '0|m|echo:three']);
      });
    });

    it('connects to the worker at /websocket/, with the shared secret', function() {
      return sockjsClient.connect_p(server.port, '/myapp/').then(function(conn) {
        track(conn);
        conn.send('0|o|');
        conn.send('0|m|hello');
        return conn.next_p();
      })
      .then(function() {
        var ups = upgrades(server);
        assert.strictEqual(ups.length, 1);
        assert.strictEqual(ups[0].url, '/websocket/');
        assert.strictEqual(ups[0].headers['shiny-shared-secret'],
          server.worker.last().endpoint.getSharedSecret());
      });
    });

    it('holds a sock connection on the worker until the session closes', function() {
      var conn;
      return sockjsClient.connect_p(server.port, '/myapp/').then(function(c) {
        conn = track(c);
        conn.send('0|o|');
        conn.send('0|m|hello');
        return conn.next_p();
      })
      .then(function() {
        var entries = server.workerEntries();
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].data.sockConn, 1);
        // No app page was requested first, so there was no pending
        // reservation to convert -- and the release must not go negative.
        assert.strictEqual(entries[0].data.pendingConn, 0);

        conn.close();
        return waitFor_p(function() {
          return entries[0].data.sockConn === 0;
        }, 'sockConn to return to 0');
      });
    });

    it('tells the browser the app exited, and closes the channel with APP_EXIT', function() {
      return sockjsClient.connect_p(server.port, '/myapp/').then(function(conn) {
        track(conn);
        conn.send('0|o|');
        conn.send('0|m|hello');
        return conn.next_p().then(function() {
          conn.send('0|m|crash');
          return readUntil_p(conn, parseChannelClose);
        });
      })
      .then(function(msgs) {
        var close = parseChannelClose(msgs[msgs.length - 1]);
        assert.strictEqual(close.code, errorcode.APP_EXIT);

        var alerts = msgs.map(function(msg) {
          var m = /^0\|m\|(.*)$/.exec(msg);
          var payload = m && JSON.parse(m[1]);
          return payload && payload.custom && payload.custom.alert;
        }).filter(Boolean);
        assert.strictEqual(alerts.length, 1, 'messages were: ' + msgs.join(', '));
        assert.ok(/unexpectedly exited/.test(alerts[0]), alerts[0]);
      });
    });
  });

  describe('over the XHR fallback', function() {
    // This transport arrives as ordinary HTTP requests, so unlike the native
    // WebSocket it goes through the Express middleware stack before reaching
    // the SockJS server.

    beforeEach(function() {
      return start_p();
    });

    it('relays messages in both directions', function() {
      var base = '/myapp/__sockjs__/000/xhrsession';
      function post_p(path, body) {
        return server.get_p(base + path, {
          method: 'POST',
          headers: body ? {'Content-Type': 'text/plain'} : {},
          body: body
        });
      }

      return post_p('/xhr').then(function(r) {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body, 'o\n');
        return post_p('/xhr_send', JSON.stringify(['0|o|', '0|m|hello']));
      })
      .then(function(r) {
        assert.strictEqual(r.status, 204);
        return post_p('/xhr');
      })
      .then(function(r) {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body, 'a' + JSON.stringify(['0|m|echo:hello']) + '\n');
      });
    });
  });

  describe('robust sessions', function() {

    it('resume on a new transport, replaying what was missed, without reconnecting to the worker', function() {
      var session;
      return start_p().then(function() {
        session = track(new sockjsClient.RobustSession(server.port, '/myapp/'));
        return session.connect_p();
      })
      .then(function() {
        session.send('0|o|');
        session.send('0|m|one');
        return session.next_p();
      })
      .then(function(msg) {
        assert.strictEqual(msg, '0|m|echo:one');
        // Lose the transport, as a laptop going to sleep would. RobustConn
        // withholds the close for 15 seconds, so the worker never hears of it.
        session.transport.close();
        return session.transport.closed_p;
      })
      .then(function() {
        // The app keeps talking while the browser is away. RobustConn must
        // buffer this and replay it once the client CONTINUEs.
        server.worker.last().websockets[0].send('sent while away');
        return session.connect_p();
      })
      .then(function() {
        return session.next_p();
      })
      .then(function(msg) {
        assert.strictEqual(msg, '0|m|sent while away');
        // The server's CONTINUE carries the first client message id it has
        // not seen; it saw two ("0|o|" and "0|m|one").
        assert.deepStrictEqual(session.continuesReceived, [2]);

        session.send('0|m|two');
        return session.next_p();
      })
      .then(function(msg) {
        assert.strictEqual(msg, '0|m|echo:two');
        assert.strictEqual(upgrades(server).length, 1,
          'the worker-side WebSocket should have survived the reconnect');
      });
    });

    it('are refused for an app with reconnect off', function() {
      var session;
      return start_p({locationBody: '    reconnect false;'}).then(function() {
        session = track(new sockjsClient.RobustSession(server.port, '/myapp/'));
        return session.connect_p();
      })
      .then(function() {
        session.send('0|o|');
        return session.next_p();
      })
      .then(function(msg) {
        var close = parseChannelClose(msg);
        assert.ok(close, 'expected a channel close, got: ' + msg);
        assert.strictEqual(close.code, errorcode.ACCESS_DENIED);
        assert.strictEqual(upgrades(server).length, 0);
      });
    });
  });

  describe('on URLs that are not a servable app', function() {
    // A SockJS connection reaches the routers with no `res`: sockjs.js calls
    // getAppSpec_p(conn) with just the connection. A router branch that writes
    // a response anyway throws, the exception is uncaught, and lib/main.js
    // shuts the whole server down -- every user's session with it. Each URL
    // here is one channel-open away from a branch that writes to `res`.

    beforeEach(function() {
      return start_p();
    });

    [
      ['a hidden path element', '/myapp/.hidden/'],
      ['a ".." segment', '/elsewhere/../myapp/'],
      ['an encoded ".." segment', '/elsewhere/%2e%2e/myapp/'],
      ['a static directory', '/static/'],
      ['a path that does not exist', '/nope/']
    ].forEach(function(testCase) {
      it('leave the server running for ' + testCase[0] + ' (' + testCase[1] + ')', function() {
        return sockjsClient.connect_p(server.port, testCase[1]).then(function(conn) {
          track(conn);
          // Opening a channel is what consults the routers. Nothing comes
          // back for a URL that isn't an app, so give the routers a moment.
          conn.send('0|o|');
          return delay_p(250);
        })
        .then(function() {
          return server.get_p('/ping');
        })
        .then(function(r) {
          assert.strictEqual(r.status, 200);
          assert.strictEqual(upgrades(server).length, 0);
        });
      });
    });
  });
});
