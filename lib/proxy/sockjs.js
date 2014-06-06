/*
 * sockjs.js
 *
 * Copyright (C) 2009-13 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
var assert = require('assert');
var events = require('events');
var util = require('util');
var pause = require('pause');
var sockjs = require('sockjs');
var websocket = require('faye-websocket');
var OutOfCapacityError = require('../core/errors').OutOfCapacity;
var _ = require('underscore');
var fsutil = require('../core/fsutil');
var shutdown = require('../core/shutdown');
var render = require('../core/render');

exports.createServer = createServer;
function createServer(router, schedulerRegistry, websocketsDisabled) {
  // Create a single SockJS server that will serve all applications. We'll use
  // the connection.url to dispatch among the different worker processes'
  // websocket ports. Once a connection is established, we simply pipe IO
  // between the SockJS server connection and the worker websocket connection.
  var sockjsServer = sockjs.createServer({
    // TODO: make URL configurable
    sockjs_url: '//d1fxtkz8shb9d2.cloudfront.net/sockjs-0.3.min.js',
    prefix: '.*/__sockjs__',
    websocket: !websocketsDisabled,
    log: function() {}
  });

  sockjsServer.on('connection', function(conn) {
    var msSocket = new MultiplexSocket(conn);
    msSocket.on('connection', function(mconn) {
      handleMultiplexChannel(mconn);
    });
  });

  function handleMultiplexChannel(conn) {
    if (!conn) {
      // We saw conn===null in the wild one time
      logger.debug('Falsy SockJS connection detected');
      return;
    }
    logger.trace('Accepted SockJS connection for ' + conn.url);

    // Since getAppSpec_p is asynchronous, we need to pause the connection's
    // data and close events in order to not let data get lost while we wait
    var paused = pause(conn);
    // What app is the client trying to reach?
    router.getAppSpec_p(conn)
    .then(function(appSpec) {
      if (!appSpec) {
        logger.error('Websocket 404: ' + conn.url);
        return;
      }
      if (appSpec === true) {
        return;  // Request was fully handled
      }
      connectToApp(conn, appSpec);
    })
    .fin(function() {
      // Now that event handlers are hooked up to the connection, it's safe
      // to unpause
      paused.resume();
    })
    .done();
  };

  function connectToApp(conn, appSpec) {

    // The connection to the worker process.
    var wsClient = null;

    // Represents the worker process.
    var appWorkerHandle = null;

    // Buffer queue for any events that arrive on the SockJS connection before
    // the worker websocket connection has been established.
    var connEventQueue = [];

    // Giving this event listener a name so we can remove it later
    var connDataHandler = function(message) {
      connEventQueue.push({event: 'data', data: [message]});
    };

    conn.on('data', connDataHandler);
    conn.on('close', function() {
      // Must, must, must match up acquire() and release() calls.
      if (appWorkerHandle) {
        appWorkerHandle.release('sock');
        appWorkerHandle = null;
      }
      if (wsClient) {
        wsClient.close();
      }
    });

    
    //TODO: clean this up. This should be a part of the promise chain, but
    // when returning an error, it would just crash as an unhandled excptn
    // and never make it into the .fail().
    var wrk;
    try{
      // Can't specify the URL that we're requesting, so provide 'ws' to
      // represent that this request is for a web socket.
      wrk = schedulerRegistry.getWorker_p(appSpec, 'ws');
    }
    catch(err){
      if (err instanceof OutOfCapacityError){
        conn.close();
        return;
      }
      throw err;
    }
    wrk
    .then(function(awh) {
      if (conn.readyState >= 2) // closing or closed
        return;

      appWorkerHandle = awh;
      appWorkerHandle.acquire('sock');

      var wsUrl = 'ws://127.0.0.1/';
      var pathInfo = conn.url.substring(appSpec.prefix.length);
      
      // Prepend a slash.
      if (!pathInfo.match(/^\//)){
        pathInfo = '/' + pathInfo;
      }
      
      pathInfo = pathInfo.replace(/\/__sockjs__\/.*/, "/websocket/");
      wsClient = appWorkerHandle.endpoint.createWebSocketClient(pathInfo);

      wsClient.onopen = function(event) {
        conn.removeListener('data', connDataHandler);
        conn.on('data', _.bind(wsClient.send, wsClient));

        // If any conn events queued up while we were waiting for the
        // websocket client to connect, emit them now.
        var queuedEvent;
        while ((queuedEvent = connEventQueue.shift())) {
          conn.emit.apply(conn, [queuedEvent.event].concat(queuedEvent.data));
        }
      };

      wsClient.onerror = function(event) {
        // TODO: Send error message and stderr to client via websocket; this
        // means we couldn't connect to the websocket
        conn.close();
      };

      wsClient.onmessage = function(event) {
        conn.write(event.data);
      };

      wsClient.onclose = function(event) {
        // Did the client side already close? If so, then this is a normal
        // close, no need to log anything.
        if (conn.readyState > 1) // closing or closed
          return;

        // Send error message and stderr to client via websocket; this
        // is an unexpected close (i.e. the R process terminated).
        fsutil.safeTail_p(appWorkerHandle.logFilePath, 8192)
        .fail(function(consoleLog) {
          return '';
        })
        .then(function(consoleLog) {
          render.sendClientConsoleMessage(conn, consoleLog);
          var moreInfo = consoleLog
              ? "\r\n\r\nDiagnostic information has been dumped to the JavaScript error console."
              : "";

          var exitMessage = shutdown.shuttingDown ?
              'The server is restarting.\r\n\r\nPlease wait a few moments, then refresh the page.' :
              'The application unexpectedly exited.' + moreInfo;
          render.sendClientAlertMessage(conn, exitMessage);
        })
        .fail(function(err) {
          logger.error('Failed to send client close message: ' + err.message);
        })
        .fin(function() {
          try {
            conn.close();
          } catch (err) {
            logger.error('Failed to close SockJS conn: ' + err.message);
          }
        })
        .done();
      };

    })
    .fail(function(err) {
      // TODO: Write error to websocket, or something
      logger.error('Error getting worker: ' + err);
      try {
        conn.close();
      } catch (err) {
        logger.error('Failed to close SockJS conn: ' + err.message);
      }
    })
    .done();

  }

  return sockjsServer;
}

// MultiplexSocket sits on top of a SockJS server connection and raises
// "connection" events with logical SockJS server connections (channels)
// that look and behave like normal SockJS server connections, but share
// a single SockJS connection. Channels cannot outlive (or predate, for
// that matter) their underlying connections.
//
// Each message that comes across the physical connection will be tagged
// with the "id" of its logical connection. These ids need only be unique
// within the scope of each MultiplexSocket.
//
// Messages are strings formatted like this:
//
// channelId|method|data
//
// A message can be one of three types (methods):
//
// - "o": Open a new channel @ channelId (data is request URL)
// - "c": Close the channel (data has {code, reason})
// - "m": Channel message (data is the message)
//
// See shiny-server.js for the corresponding client code.

function MultiplexSocket(conn) {
  events.EventEmitter.call(this);
  this.$conn = conn; // The single true SockJS connection that was opened
  this.$channels = {}; // The list of currently active channels

  var self = this;
  conn.on('close', function() {
    // The physical connection has gone away, we need to notify anyone
    // who is using any active channel.
    _.each(_.values(self.$channels), function(channel) {
      channel._destroy();
    });
    self.$channels = {};
  });
  conn.on('data', function(message) {
    // Message received from physical connection; parse and dispatch it
    var message = parseMultiplexData(message);
    if (!message) {
      logger.warn('Invalid multiplex packet received');
      conn.close();
      return;
    }
    
    var id = message.id;
    var method = message.method;
    var payload = message.payload;

    var channel = self.$channels[id];
    if (!channel) {
      if (method === 'o') {
        // It's a request to open a new channel with the given id.
        // We want the channel to look a lot like a real SockJS connection,
        // so let's copy the properties from the actual connection. We'll
        // overwrite the `url` though, to use the channel's URL.
        var properties = _.extend(_.pick(conn, connectionProps), {url: payload});
        var channel = new MultiplexChannel(id, conn, properties);
        self.$channels[id] = channel;
        self.emit('connection', channel);
      } else {
        // TODO: ...what? Close conn?
      }
    }
    else {
      // The channel exists

      if (method === 'c') {  // The client closed the channel
        channel._destroy(payload.code, payload.reason);
      } else if (method === 'm') {  // The client sent a message
        channel.emit('data', payload);
      }
    }
  });
}
util.inherits(MultiplexSocket, events.EventEmitter);

(function() {
}).call(MultiplexSocket.prototype);

// Fake SockJS connection that can be multiplexed over a real SockJS
// connection.
function MultiplexChannel(id, conn, properties) {
  events.EventEmitter.call(this);
  this.$id = id;  // The channel id
  this.$conn = conn;  // The underlying SockJS connection
  _.extend(this, properties);  // Apply extra properties to this object
  assert(this.readyState === 1); // copied from the (definitely active) conn
}
util.inherits(MultiplexChannel, events.EventEmitter);

(function() {
  this.write = function(message) {
    if (this.readyState === 1)
      this.$conn.write(formatMessage(this.$id, message));
  };
  this.close = function(code, reason) {
    if (this.readyState === 1 && this.$conn.readyState === 1)
      this.$conn.write(formatCloseEvent(this.$id, code, reason));
    this._destroy(code, reason);
  };
  this.end = function() {
    this.close();
  };
  // Internal function to set the readyState and raise "close" event.
  // This can be used in place of close() when we don't want to send
  // a message to the client.
  this._destroy = function(code, reason) {
    this.readyState = 3;
    this.emit('close', {code: code, reason: reason});
  };
}).call(MultiplexChannel.prototype);

function formatMessage(id, message) {
  return id + '|m|' + message;
}
function formatOpenEvent(id, url) {
  return id + '|o|' + url;
}
function formatCloseEvent(id, code, reason) {
  return id + '|c|' + JSON.stringify({code: code, reason: reason});
}
function parseMultiplexData(msg) {
  try {
    var m = /^(\d+)\|(m|o|c)\|([\s\S]*)$/m.exec(msg);
    if (!m)
      return null;
    msg = {
      id: m[1],
      method: m[2],
      payload: m[3]
    }

    switch (msg.method) {
      case 'm':
        break;
      case 'o':
        if (msg.payload.length === 0)
          return null;
        break;
      case 'c':
        try {
          msg.payload = JSON.parse(msg.payload);
        } catch(e) {
          return null;
        }
        break;
      default:
        return null;
    }

    return msg;

  } catch(e) {
    logger.debug('Error parsing multiplex data: ' + e);
    return null;
  }
}


// Properties to copy from sockjs connection to MultiplexChannel
var connectionProps = ['readable', 'writable', 'remoteAddress',
  'remotePort', 'address', 'headers', /* 'url', */ 'pathname',
  'prefix', 'protocol', 'readyState'];