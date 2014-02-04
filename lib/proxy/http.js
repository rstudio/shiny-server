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

var error404 = render.error404;
var errorAppOverloaded = render.errorAppOverloaded;

// Send a 500 error response
function error500(req, res, errorText, detail, templateDir, consoleLogFile) {
  fsutil.safeTail_p(consoleLogFile, 8192)
  .fail(function(consoleLog) {
    return;
  })
  .then(function(consoleLog) {
    render.sendPage(res, 500, 'An error has occurred', {
      template: 'error-500',
      templateDir: templateDir,
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

    var buffer = http_proxy.buffer(req);
    
    // Figure out what application this URL belongs to, who it should run as,
    // where the log file goes, etc.
    router.getAppSpec_p(req, res)
    .then(function(appSpec) {

      if (!req.socket.writable) {
        logger.debug("Socket closed, httpListener aborting");
        return;
      }
      if (appSpec === true) {
        // Router fully handled the request
        return;
      }
      if (!appSpec) {
        error404(req, res, req.templateDir);
        return;
      }

      var worker = qs.parse(req._parsedUrl.query).w;

      if (worker){
        logger.trace("Using worker #" + JSON.stringify(worker));
      }

      if (req.url.indexOf(appSpec.prefix) != 0) {
        logger.error('Bad router returned invalid prefix: "' + appSpec.prefix + '" for URL "' + req.url + '"');
        error404(req, res, appSpec.settings.templateDir);
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
          errorAppOverloaded(req, res, appSpec.settings.templateDir);
          return;
        }
        throw err;
      }

      var acquired = false;
      // Launch a new, or reuse an existing, R process for this app.
      wrk
      .then(function(appWorkerHandle) {

        if (!req.socket.writable) {
          logger.debug("Socket closed, ignoring appWorkerHandle and returning");
          return;
        }

        // Ensures that the worker process will not be reaped while we use it.
        appWorkerHandle.acquire('http');
        acquired = true;

        // Save a reference to the appWorkerHandle on the response so that we
        // can call appWorkerHandle.release() when the request ends.
        res.appWorkerHandle = appWorkerHandle;

        if (!appWorkerHandle.proxy) {
          // Cache an HTTP proxy right on the appWorkerHandle.
          appWorkerHandle.proxy = createHttpProxy(appWorkerHandle);
          appWorkerHandle.exitPromise
          .fin(function(status) {
            appWorkerHandle.proxy.close();
            logger.trace(appWorkerHandle.endpoint.ToString() + ' proxy closed');
          })
          .eat();
        }
        
        // We add this listener before trying to proxy, so it will be handled 
        // first, meaning we won't yet have nulled out the req object.
        req.on('error', function(err) {
          logger.error('Error during proxy: ' + err.message);
          error500(req, res, 'An error occurred while transferring data from the application.',
              err.message, appSpec.settings.templateDir, appWorkerHandle.logFilePath);
        });

        logger.trace('Proxying request: ' + req.url);
        req.headers['shiny-shared-secret'] = appWorkerHandle.endpoint.getSharedSecret();
        // Remember that we will null out req and res in the proxy, so be careful
        // trying to subscribe to events on them after we've started this proxy.
        appWorkerHandle.proxy.proxyRequest(req, res, buffer);
      })
      .fail(function(err) {
        if (acquired){
          cleanupResponse(res);
        }
        logger.info('Error getting worker: ' + err);
        if (err.code === 'ENOTFOUND')
          error404(req, res, appSpec.settings.templateDir);
        else {
          error500(req, res, 'The application failed to start.', err.message,
              appSpec.settings.templateDir, err.consoleLogFile);
        }
      })
      .done();
    })
    .fail(function(err){
      error500(req, res, 'Invalid application configuration.', err.message, 
        req.templateDir);
    })
    .done();
  };

  /**
   * Very important that this is called on every response that we've even
   * begun attempting to proxy; it ensures that the R process can be
   * released when idle.
   */
  function cleanupResponse(response) {
    if (response.appWorkerHandle){
      response.appWorkerHandle.release('http');
    }
    delete response.appWorkerHandle;
  }


  // Create an HTTP proxy object for the given socket; we need one of these per
  // active socket. node-http-proxy has a RoutingProxy that provides a more
  // suitable interface (you can specify a different target for each call to
  // proxyRequest) but the implementation caches every proxy it creates
  // forever, so that's much worse than just doing it ourselves.
  function createHttpProxy(appWorkerHandle) {

    var proxy = new http_proxy.HttpProxy({
      target: appWorkerHandle.endpoint.getHttpProxyTarget()
    });

    // Once we switched the connection between node and the R workers from TCP
    // to Unix domain sockets, keepalive management from the node side seemed
    // to stop working. The behavior we observed (using our manual loadtest.js
    // script) was that node would request to keep the connection open, but not
    // actually reuse the connection. This would lead the node process to hit
    // the limit of open files (defaults to 1024 on Linux and only 256 on Mac).
    //
    // This fixes the problem by rewriting the Connection header in both
    // directions while proxying; always close the connection to the target,
    // while respecting the original connection header from the client.
    proxy.on('start', function(req, res, target) {
      req.keepalive = isKeepalive(req);
      stripConnectionHeaders(req);
      req.headers.connection = 'close';
    });
    proxy.on('proxyResponse', function(req, res, response) {
      response.headers.connection = req.keepalive ? 'keep-alive' : 'close';
    });

    proxy.on('proxyError', function(err, req, res) {
      // This happens when an error occurs during request proxying, for example
      // if the upstream server drops the connection.
      error500(req, res, 'The application exited unexpectedly.', err.message,
          req.templateDir, appWorkerHandle.logFilePath);
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


// Determine if keepalive is desired by the client that generated this request
function isKeepalive(req) {
  var conn = req.headers.connection;
  if (typeof(conn) === 'undefined' || conn === null)
    conn = '';
  conn = conn.trim().toLowerCase();

  if (/\bclose\b/i.test(conn))
    return false;
  if (/\bkeep-alive\b/i.test(conn))
    return true;

  // No Connection header. Default to keepalive for 1.1, non for 1.0.
  if (req.httpVersionMajor < 1 || req.httpVersionMinor < 1) {
    return false;
  } else {
    return true;
  }
}

// Per RFC 2616 section 14.10:
//
// HTTP/1.1 proxies MUST parse the Connection header field before a
// message is forwarded and, for each connection-token in this field,
// remove any header field(s) from the message with the same name as the
// connection-token.
function stripConnectionHeaders(req) {
  var conn = req.headers.connection;
  if (typeof(conn) === 'undefined' || conn === null)
    return;

  conn.split(/\s+/g).forEach(function(header) {
    if (header.length === 0)
      return;
    delete req.headers[header.toLowerCase()];
  });
  delete req.headers.connection;
}
