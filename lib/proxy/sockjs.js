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
      handleMultiplexSocket(mconn);
    });
  });

  function handleMultiplexSocket(conn) {
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


// Messages from the client will be in this format:
// [channelId, method, data]
// Method will be one of:
// - "o": Open a new channel @ channelId (data is request URL)
// - "c": Close the channel (data has {code, reason})
// - "m": Channel message (data is the message)

function MultiplexSocket(conn) {
  events.EventEmitter.call(this);
  this.$conn = conn; // The single true SockJS connection that was opened
  this.$channels = {};

  var self = this;
  conn.on('close', function() {
    _.each(_.values(this.$channels), function(channel) {
      channel.close();
    });
  });
  conn.on('data', function(message) {
    var message = parseMultiplexData(message);
    if (!message) {
      logger.warn('Invalid multiplex packet received');
      conn.close();
    }
    var id = message[0];
    var method = message[1];
    var payload = message.length > 2 ? message[2] : null;
    var channel = self.$channels[id];
    if (!channel) {
      if (message[1] === 'o') {
        var url = message[2];
        var properties = _.extend(_.pick(conn, connectionProps), {url: url});
        var channel = new MultiplexChannel(id, conn, properties);
        self.$channels[id] = channel;
        self.emit('connection', channel);
      } else {
        // TODO: ...what? Close conn?
      }
    }
    else {
      if (method === 'c') {
        channel.emit('close',
          {code: payload.code, reason: payload.reason});
      } else if (method === 'm') {
        channel.emit('data', payload);
      }
    }
  });
}
util.inherits(MultiplexSocket, events.EventEmitter);

(function() {
}).call(MultiplexSocket.prototype);

function MultiplexChannel(id, conn, properties) {
  events.EventEmitter.call(this);
  this.$id = id;
  this.$conn = conn;
  _.extend(this, properties);
  assert(this.readyState == 1);

  this.on('close', function() {
    this.readyState = 3;
  });
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
    this.emit('close');
  };
  this.end = function() {
    this.close();
  };
}).call(MultiplexChannel.prototype);

function formatMessage(id, message) {
  return JSON.stringify([id, 'm', message]);
}
function formatOpenEvent(id) {
  return JSON.stringify([id, 'o']);
}
function formatCloseEvent(id, code, reason) {
  return JSON.stringify([id, 'c', {code: code, reason: reason}]);
}
function parseMultiplexData(msg) {
  try {
    msg = JSON.parse(msg);
  }
  catch(e) {
    return null;
  }

  var len = msg.length;
  if (len < 2)
    return null;
  if (typeof(msg[0]) !== 'string' && msg[0].length > 0)
    return null;
  switch (msg[1]) {
    case 'm':
      if (len != 3 || typeof(msg[2]) !== 'string')
        return null;
      break;
    case 'o':
      if (len != 3 || typeof(msg[2]) !== 'string')
        return null;
      break;
    case 'c':
      if (len != 3 || typeof(msg[2].code) !== 'number' ||
          typeof(msg[2].reason) !== 'string') {
        return null;
      }
      break;
    default:
      return null;
  }

  return msg;
}

// Properties to copy from sockjs connection to MultiplexChannel
var connectionProps = ['readable', 'writable', 'remoteAddress',
  'remotePort', 'address', 'headers', /* 'url', */ 'pathname',
  'prefix', 'protocol', 'readyState'];