#!/usr/bin/env node

var url = require('url');
var proxy = require('../lib/proxy/proxy');
var router = require('../lib/router/router')
var WorkerRegistry = require('../lib/worker/worker-registry');

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

var shinyProxy = new proxy.ShinyProxy(
  router.join(
    new router.AutouserRouter(autouserOptions),
    homepageRedirect
  ),
  new WorkerRegistry()
);
shinyProxy.httpServer.listen(
  parseInt(process.env.SHINY_PORT || 80),
  process.env.SHINY_HOST);
