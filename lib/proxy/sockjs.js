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
var pause = require('pause');
var sockjs = require('sockjs');
var OutOfCapacityError = require('../core/errors').OutOfCapacity;
var _ = require('underscore');
var fsutil = require('../core/fsutil');
var shutdown = require('../core/shutdown');
var render = require('../core/render');
var MultiplexSocket = require('./multiplex');
var RobustSockJS = require('./robust-sockjs');
var errorcode = require("./errorcode");

exports.createServer = createServer;
function createServer(router, schedulerRegistry, heartbeatDelay, disconnectDelay, reconnectTimeout) {
  if (!heartbeatDelay || heartbeatDelay < 0) {
    logger.warn("Ignoring invalid SockJS heartbeat delay: " + heartbeatDelay);
    heartbeatDelay = 25 * 1000;
  }
  if (!disconnectDelay || disconnectDelay < 0) {
    logger.warn("Ignoring invalid SockJS disconnect delay: " + disconnectDelay);
    disconnectDelay = 5 * 1000;
  }

  // Create a single SockJS server that will serve all applications. We'll use
  // the connection.url to dispatch among the different worker processes'
  // websocket ports. Once a connection is established, we simply pipe IO
  // between the SockJS server connection and the worker websocket connection.
  var sockjsServer = sockjs.createServer({
    // TODO: make URL configurable
    sockjs_url: '//d1fxtkz8shb9d2.cloudfront.net/sockjs-0.3.min.js',
    prefix: '.*/__sockjs__(/[no]=\\w+)?',
    log: function() {},
    heartbeat_delay: heartbeatDelay,
    disconnect_delay: disconnectDelay
  });

  var robust = new RobustSockJS(reconnectTimeout);
  sockjsServer.on('connection', function(conn) {
    var robustConn = robust.robustify(conn);
    if (!robustConn){
      return;
    }
    onMultiplexConnect(robustConn);
  });

  function onMultiplexConnect(conn){
    var msSocket = new MultiplexSocket(conn);
    msSocket.on('connection', function(mconn) {
      handleMultiplexChannel(mconn, conn.robust);
    });
  }

  function handleMultiplexChannel(conn, robust) {
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
      if (!appSpec.settings.appDefaults.reconnect && robust) {
        logger.info("Shutting down robust connection for non-reconnect app");
        conn.close(errorcode.ACCESS_DENIED, "Access denied");
        return;
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

    // Buffer queue for any events that arrive on the SockJS connection before
    // the worker websocket connection has been established.
    var connEventQueue = [];

    // Giving this event listener a name so we can remove it later
    var connDataHandler = function(message) {
      connEventQueue.push({event: 'data', data: [message]});
    };

    conn.on('data', connDataHandler);
    conn.on('close', function() {
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
      wrk = schedulerRegistry.getWorker(appSpec, 'ws');
    }
    catch(err){
      if (err instanceof OutOfCapacityError){
        conn.close(errorcode.OUT_OF_CAPACITY, "Out of capacity");
        return;
      }
      throw err;
    }

    // In the common case, a SockJS connection is requested because of an HTTP
    // request to a top-level app page, and that HTTP request incremented the
    // pending connection count (wrk.acquire("pending")) in anticipation of
    // this connection. A pending conn is essentially a reservation for a sock
    // conn; now that the sock conn has arrived, we can/must release the
    // reservation.
    wrk.shiftPendingReleaseTimer();
    wrk.release("pending");

    wrk.acquire("sock");
    conn.on("close", _.once(() => {
      // Must, must, must match up acquire() and release() calls.
      wrk.release('sock');
    }));

    wrk.getAppWorkerHandle_p().then(function(appWorkerHandle) {
      if (conn.readyState >= 2) // closing or closed
        return;

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
          if (appSpec.settings.appDefaults.sanitizeErrors) {
            var moreInfo = consoleLog
              ? "\r\n\r\nDiagnostic information is private. Please ask your system admin for " +
              "permission if you need to check the R logs."
              : "";
          } else {
            render.sendClientConsoleMessage(conn, consoleLog);
            var moreInfo = consoleLog
              ? "\r\n\r\nDiagnostic information has been dumped to the JavaScript error console."
              : "";
          }
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
            if (shutdown.shuttingDown) {
              // Tell client not to try to reconnect to old session; but if
              // Shiny wants to automatically start a new session, that's OK.
              conn.close(errorcode.SHUTTING_DOWN, "The server is shutting down");
            } else {
              conn.close(errorcode.APP_EXIT, "The application unexpectedly exited");
            }
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
