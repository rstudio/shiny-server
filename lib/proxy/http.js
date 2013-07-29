/*
 * http.js
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
var http = require('http');
var util = require('util');
var http_proxy = require('http-proxy');
var qs = require('qs');
var Q = require('q');
var _ = require('underscore');
var OutOfCapacityError = require('../core/errors').OutOfCapacity;
var AppSpec = require('../worker/app-spec');
var fsutil = require('../core/fsutil');
var render = require('../core/render');
var shutdown = require('../core/shutdown');

// Send a 404 error response
function error404(req, res) {
  render.sendPage(res, 404, 'Page not found', {
    vars: {
      message: "Sorry, but the page you requested doesn't exist."
    }
  });
}

// Send a 503 error response
function error503(req, res) {
  render.sendPage(res, 503, 'Server overloaded', {
    vars: {
      message: "Sorry, but the server is too busy to fulfill this request right now. Please try again later."
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
 * @param {SchedulerRegistry} schedulerRegistry - Implementation of a scheduler
 *   registry, which launches and manages scheduler processes in response to
 *   AppSpec requests.
 * @param {Router} router - Implementation of a router, which is capable
 *   of mapping a URL to an AppSpec.
 */
function ShinyProxy(router, schedulerRegistry) {
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

    // Once we switched the connection between node and the R workers from TCP
    // to Unix domain sockets, keepalive management from the node side seemed
    // to stop working. The behavior we observed (using our manual loadtest.js
    // script) was that node would request to keep the connection open, but not
    // actually reuse the connection. This would lead the node process to hit
    // the limit of open files (defaults to 1024 on Linux and only 256 on Mac).
    //
    // This fixes the problem by closing every node<=>R connection immediately,
    // but it also causes the browser<=>node connection to close. It's not
    // immediately clear to me what's involved in making keepalive work between
    // the browser and node, while turning off keepalive between node and R.
    // Note that this is a bigger problem with https than it is with http since
    // it's more expensive to establish a connection in the latter case.
    req.headers['connection'] = 'Close';

    var buffer = http_proxy.buffer(req);

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

      var worker = qs.parse(req._parsedUrl.query).w;

      if (worker){
        logger.trace("Using worker #" + JSON.stringify(worker));
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

      //TODO: clean this up. This should be a part of the promise chain, but
      // when returning an error, it would just crash as an unhandled excptn
      // and never make it into the .fail().
      var wrk;
      try{
        // Extract the non-param portion of the URL
        wrk = schedulerRegistry.getWorker_p(appSpec, req.url.match(/([^\?]+)(\?.*)?/)[1], 
        worker)
      }
      catch(err){
        if (err instanceof OutOfCapacityError){
          logger.trace("Out of capacity, serving 503 for request '" + req.url + "'");
          error503(req, res);
          return;
        }
        throw err;
      }

      // Launch a new, or reuse an existing, R process for this app.
      wrk
      .then(function(appWorkerHandle) {

        // Ensures that the worker process will not be reaped while we use it.
        appWorkerHandle.acquire('http');

        // Save a reference to the appWorkerHandle on the response so that we
        // can call appWorkerHandle.release() when the request ends.
        res.appWorkerHandle = appWorkerHandle;

        if (!appWorkerHandle.proxy) {
          // Cache an HTTP proxy right on the appWorkerHandle.
          appWorkerHandle.proxy = createHttpProxy(appWorkerHandle);
          appWorkerHandle.exitPromise
          .fin(function(status) {
            appWorkerHandle.proxy.close();
            logger.trace('Socket ' + appWorkerHandle.sockName + ' proxy closed');
          })
          .eat();
        }

        req.on('error', function(err) {
          logger.error('Error during proxy: ' + err.message);
          error500(req, res, 'An error occurred while transferring data from the application.',
              err.message, appWorkerHandle.logFilePath);
        });

        logger.trace('Proxying request: ' + req.url);
        appWorkerHandle.proxy.proxyRequest(req, res, buffer);
      })
      .fail(function(err) {
        logger.info('Error getting worker: ' + err);
        if (err.code === 'ENOTFOUND')
          error404(req, res);
        else {
          error500(req, res, 'The application failed to start.', err.message,
              err.consoleLogFile);
        }
      })
      .done();
    })
    .done();
  };

  // Create an HTTP proxy object for the given socket; we need one of these per
  // active socket. node-http-proxy has a RoutingProxy that provides a more
  // suitable interface (you can specify a different target for each call to
  // proxyRequest) but the implementation caches every proxy it creates
  // forever, so that's much worse than just doing it ourselves.
  function createHttpProxy(appWorkerHandle) {

    var proxy = new http_proxy.HttpProxy({
      target: {
        host: '127.0.0.1',
        socketPath: appWorkerHandle.socketPath
      }
    });

    /**
     * Very important that this is called on every response that we've even
     * begun attempting to proxy; it ensures that the R process can be
     * released when idle.
     */
    function cleanupResponse(response) {
      if (response.appWorkerHandle)
        response.appWorkerHandle.release('http');
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
