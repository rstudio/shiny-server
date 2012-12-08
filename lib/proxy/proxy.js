var http = require('http');
var http_proxy = require('http-proxy');
var sockjs = require('sockjs');
var websocket = require('faye-websocket');
var _ = require('underscore');
var AppSpec = require('../worker/app-spec');

// Send a 404 error response
function error404(req, res) {
  // TODO: Pretty errors
  res.writeHead(404, {'Content-Type': 'text/html'});
  res.end('<h1>Not found</h1>');
}

// Send a 500 error response
function error500(req, res, errorText) {
  // TODO: Pretty errors, stderr support, etc.
  res.writeHead(500, {'Content-Type': 'text/html'});
  res.end('<h1>500 Error: ' + errorText + '</h1>');
}

exports.ShinyProxy = ShinyProxy;
/**
 * ShinyProxy combines HTTP and websocket proxying duties, and manages these
 * for not one but many back-end HTTP/websocket servers (one for each running
 * application worker process).
 *
 * @constructor
 * @param {WorkerRegistry} workerRegistry - Implementation of a worker
 *   registry, which launches and manages worker processes in response to
 *   AppSpec requests.
 * @param {Router} router - Implementation of a router, which is capable
 *   of mapping a URL to an AppSpec.
 * @param {Object} options - Reserved.
 */
function ShinyProxy(router, workerRegistry, options) {
  var self = this;

  // The HTTP server for our proxy. For each request that comes in:
  // - Is it a SockJS request? If so, SockJS handlers deal with it before we
  //   ever get to our server function.
  // - Ask the router to figure out what application the request should be
  //   directed to. (If no application matches, respond with error 404.)
  // - Ask the worker registry for an AppWorkerHandle for the given AppSpec.
  //   An AppWorkerHandle represents a handle to a specific R process. (If
  //   error, respond with error 500.)
  // - If the AppWorkerHandle has no proxy field, create it.
  // - Proxy the request.
  this.httpServer = http.createServer(function(req, res) {

    var buffer = http_proxy.buffer(req);

    // Figure out what application this URL belongs to, who it should run as,
    // where the log file goes, etc.
    var appSpec = router.getAppSpec(req);
    if (!appSpec) {
      return error404(req, res);
    }

    if (req.url.indexOf(appSpec.prefix) != 0) {
      trace.error('Bad router returned invalid prefix: "' + appSpec.prefix + '" for URL "' + req.url + '"');
      return error404(req, res);
    }

    req.url = req.url.substring(appSpec.prefix.length);
    if (req.url.indexOf('/') != 0)
      req.url = '/' + req.url;
    // TODO: Also strip path members

    // Launch a new, or reuse an existing, R process for this app.
    workerRegistry.getWorker_p(appSpec).then(
      function(appWorkerHandle) {

        // Ensures that the worker process will not be reaped while we use it.
        appWorkerHandle.acquire();

        // Save a reference to the appWorkerHandle on the response so that we
        // can call appWorkerHandle.release() when the request ends.
        res.appWorkerHandle = appWorkerHandle;

        if (!appWorkerHandle.proxy) {
          // Cache an HTTP proxy right on the appWorkerHandle.
          appWorkerHandle.proxy = createHttpProxy(appWorkerHandle);
          appWorkerHandle.exitPromise.fin(function(status) {
            appWorkerHandle.proxy.close();
            logger.trace('Port ' + appWorkerHandle.port + ' proxy closed');
          });
        }

        req.on('error', function(err) {
          logger.error('Error during proxy: ' + err.message);
        });

        logger.trace('Proxying request: ' + req.url);
        appWorkerHandle.proxy.proxyRequest(req, res, buffer);
      },
      function(err) {
        // TODO: Respond with error
        error500(req, res, 'Could not get worker - ' + err);
      }
    ).done();
  });

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
        // TODO: Send error message and stderr to client via websocket; this
        // is an unexpected close (i.e. the R process terminated).
        conn.close();
      };

    }).done();

  });

  sockjsServer.installHandlers(this.httpServer);


  // Create an HTTP proxy object for the given port; we need one of these per
  // active port. node-http-proxy has a RoutingProxy that provides a more
  // suitable interface (you can specify a different target for each call to
  // proxyRequest) but the implementation caches every proxy it creates
  // forever, so that's much worse than just doing it ourselves.
  function createHttpProxy(appWorkerHandle) {

    var proxy = new http_proxy.HttpProxy({
      target: {
        host: '127.0.0.1',
        port: appWorkerHandle.port
      }
    });

    /**
     * Very important that this is called on every response that we've even
     * begun attempting to proxy; it ensures that the R process can be
     * released when idle.
     */
    function cleanupResponse(response) {
      if (response.appWorkerHandle)
        response.appWorkerHandle.release();
      delete response.appWorkerHandle;
    }

    proxy.on('proxyError', function(err, req, res) {
      // This happens when an error occurs during request proxying, for example
      // if the upstream server drops the connection.
      error500(req, res, 'proxyError');
      cleanupResponse(res);
    });
    proxy.on('end', function(req, res) {
      cleanupResponse(res);
    });
    return proxy;
  }
};

(function() {

}).call(ShinyProxy.prototype);
