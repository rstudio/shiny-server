#!/usr/bin/env node

require('./core/log');
var path = require('path');
var url = require('url');
var util = require('util');
var shutdown = require('./core/shutdown');
var proxy_http = require('./proxy/http');
var proxy_sockjs = require('./proxy/sockjs');
var router = require('./router/router')
var config_router = require('./router/config-router');
var Server = require('./server/server');
var WorkerRegistry = require('./worker/worker-registry');

// If SHINY_HOMEPAGE is defined, redirect to it on /
var homepageRedirect = process.env.SHINY_HOMEPAGE && function(req, res) {
  if (url.parse(req.url).pathname == '/') {
    res.writeHead(302, {
      'Location': process.env.SHINY_HOMEPAGE
    });
    res.end();
    return true;
  }
  return false;
};

function ping(req, res) {
  if (url.parse(req.url).pathname == '/ping') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('OK');
    return true;
  }
  return false;
}

config_router.createRouter_p(path.normalize(path.join(__dirname, '../test/config/good.config')))
.then(function(configRouter) {
  var metarouter = router.join(configRouter, ping);

  var workerRegistry = new WorkerRegistry();

  var shinyProxy = new proxy_http.ShinyProxy(
    metarouter,
    workerRegistry
  );

  var server = new Server();

  var sockjsServer = proxy_sockjs.createServer(metarouter, workerRegistry);
  server.on('request', shinyProxy.httpListener);
  sockjsServer.installHandlers(server);
  server.on('error', function(err) {
    logger.error('HTTP server error (' + err.listenKey + '): ' + err.message);
  });
  server.on('clientError', function(err) {
    logger.error('HTTP client error (' + err.listenKey + '): ' + err.message);
  });
  server.setAddresses(configRouter.getAddresses());

  // Clean up worker processes on shutdown

  var needsCleanup = true;
  function gracefulShutdown() {
    // Sometimes the signal gets sent twice. No idea why.
    if (!needsCleanup)
      return;

    // On SIGINT/SIGTERM (i.e. normal termination) we wait a second before
    // exiting so the clients can all be notified
    shutdown.shuttingDown = true;
    try {
      server.destroy();
    } catch (err) {
      logger.error('Error while attempting to stop server: ' + err.message);
    }
    logger.info('Shutting down worker processes (with notification)');
    workerRegistry.shutdown();
    needsCleanup = false;
    setTimeout(process.exit, 1000);
  }

  function lastDitchShutdown() {
    if (!needsCleanup)
      return;
    // More-violent shutdown (e.g. uncaught exception), no chance to notify
    // workers as timers won't be scheduled
    shutdown.shuttingDown = true;
    logger.info('Shutting down worker processes');
    workerRegistry.shutdown();
  }

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
  process.on('uncaughtException', function(err) {
    logger.error('Uncaught exception: ' + err);
    throw err;
    process.exit(1);
  });
  process.on('exit', lastDitchShutdown);



})
.done();
