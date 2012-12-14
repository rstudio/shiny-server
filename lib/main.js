#!/usr/bin/env node

require('./core/log');
var url = require('url');
var shutdown = require('./core/shutdown');
var proxy = require('./proxy/proxy');
var router = require('./router/router')
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


var autouserOptions = {
  gaTrackingId: process.env.SHINY_GAID
};

var workerRegistry = new WorkerRegistry();

var shinyProxy = new proxy.ShinyProxy(
  router.join(
    new router.AutouserRouter(autouserOptions),
    homepageRedirect
  ),
  workerRegistry
);
shinyProxy.httpServer.listen(
  parseInt(process.env.SHINY_PORT || 80),
  process.env.SHINY_HOST);


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
    shinyProxy.httpServer.close();
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