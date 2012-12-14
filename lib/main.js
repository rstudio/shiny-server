#!/usr/bin/env node

require('./core/log');
var url = require('url');
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


// Graceful shutdown

function shutdown() {
  logger.info('Shutting down worker processes');
  workerRegistry.shutdown();
}

process.on('SIGINT', process.exit);
process.on('SIGTERM', process.exit);
process.on('uncaughtException', function(err) {
  logger.error('Uncaught exception: ' + err);
  process.exit(1);
});
process.on('exit', shutdown);