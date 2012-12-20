var util = require('util');
var sockjs = require('sockjs');
var websocket = require('faye-websocket');
var _ = require('underscore');
var fsutil = require('../core/fsutil');
var shutdown = require('../core/shutdown');
var render = require('./render');

exports.createServer = createServer;
function createServer(router, workerRegistry) {
  // Create a single SockJS server that will serve all applications. We'll use
  // the connection.url to dispatch among the different worker processes'
  // websocket ports. Once a connection is established, we simply pipe IO
  // between the SockJS server connection and the worker websocket connection.
  var sockjsServer = sockjs.createServer({
    // TODO: make URL configurable
    sockjs_url: 'http://cdn.sockjs.org/sockjs-0.3.min.js',
    prefix: '.*/__sockjs__',
    log: function() {}
  });

  sockjsServer.on('connection', function(conn) {
    logger.trace('Accepted SockJS connection for ' + conn.url);

    // What app is the client trying to reach?
    var appSpec = router.getAppSpec(conn);
    if (appSpec === true) {
      return; // Router fully handled the request
    }
    if (!appSpec) {
      // TODO: Write an error message down to the client
      conn.close();
      return;
    }

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
        appWorkerHandle.release();
        appWorkerHandle = null;
      }
      if (wsClient) {
        wsClient.close();
      }
    });

    workerRegistry.getWorker_p(appSpec).then(function(awh) {
      if (conn.readyState >= 2) // closing or closed
        return;

      appWorkerHandle = awh;
      appWorkerHandle.acquire();

      var wsUrl = 'ws://127.0.0.1:' + appWorkerHandle.port + '/';
      wsClient = new websocket.Client(wsUrl);

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

  });

  return sockjsServer;
}
