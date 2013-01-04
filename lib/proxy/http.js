var http = require('http');
var util = require('util');
var http_proxy = require('http-proxy');
var pause = require('pause');
var Q = require('q');
var _ = require('underscore');
var AppSpec = require('../worker/app-spec');
var render = require('./render')
var fsutil = require('../core/fsutil');
var shutdown = require('../core/shutdown');

// Send a 404 error response
function error404(req, res) {
  render.sendPage(res, 404, 'Page not found', {
    vars: {
      message: "Sorry, but the page you requested doesn't exist."
    }
  });
}

// Send a 500 error response
function error500(req, res, errorText, detail, consoleLogFile) {
  fsutil.safeTail_p(consoleLogFile, 8192)
  .fail(function(consoleLog) {
    return;
  })
  .then(function(consoleLog) {
    render.sendPage(res, 500, 'An error has occurred', {
      vars: {
        message: errorText,
        detail: detail,
        console: consoleLog
      }
    });
  })
  .fail(function(err) {
    logger.error('Failed to render error 500 page: ' + err.message);
  })
  .fin(function() {
    try {
      res.end();
    } catch(err) {
      logger.error('Error while cleaning up response: ' + err);
    }
  })
  .done();
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
 */
function ShinyProxy(router, workerRegistry) {
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
  this.httpListener = function(req, res) {

    var paused = pause(req);

    // Figure out what application this URL belongs to, who it should run as,
    // where the log file goes, etc.
    router.getAppSpec_p(req, res)
    .then(function(appSpec) {

      if (appSpec === true) {
        // Router fully handled the request
        return;
      }
      if (!appSpec) {
        error404(req, res);
        return;
      }

      if (req.url.indexOf(appSpec.prefix) != 0) {
        logger.error('Bad router returned invalid prefix: "' + appSpec.prefix + '" for URL "' + req.url + '"');
        error404(req, res);
        return;
      }

      req.url = req.url.substring(appSpec.prefix.length);
      if (req.url.indexOf('/') != 0)
        req.url = '/' + req.url;
      // TODO: Also strip path members

      // Launch a new, or reuse an existing, R process for this app.
      workerRegistry.getWorker_p(appSpec)
      .then(function(appWorkerHandle) {

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
          error500(req, res, 'An error occurred while transferring data from the application.',
              err.message, appWorkerHandle.logFilePath);
        });

        logger.trace('Proxying request: ' + req.url);
        appWorkerHandle.proxy.proxyRequest(req, res);
        paused.resume();
      })
      .fail(function(err) {
        logger.info('Error getting worker: ' + err);
        if (err.code === 'ENOTFOUND')
          error404(req, res);
        else
          error500(req, res, 'The application failed to start.', err.message,
              err.consoleLogFile);
      })
      .done();
    })
    .done();
  };

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
      error500(req, res, 'The application exited unexpectedly.', err.message,
          appWorkerHandle.logFilePath);
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
