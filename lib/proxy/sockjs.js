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
function createServer(router, schedulerRegistry) {
  // Create a single SockJS server that will serve all applications. We'll use
  // the connection.url to dispatch among the different worker processes'
  // websocket ports. Once a connection is established, we simply pipe IO
  // between the SockJS server connection and the worker websocket connection.
  var sockjsServer = sockjs.createServer({
    // TODO: make URL configurable
    sockjs_url: '//d1fxtkz8shb9d2.cloudfront.net/sockjs-0.3.min.js',
    prefix: '.*/__sockjs__',
    log: function() {}
  });

  sockjsServer.on('connection', function(conn) {
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
  });

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
      wsClient = appWorkerHandle.endpoint.createWebSocketClient();

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
