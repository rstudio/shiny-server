var proxy = require('../lib/proxy/proxy');
var router = require('../lib/router/router')
var WorkerRegistry = require('../lib/worker/worker-registry');

var shinyProxy = new proxy.ShinyProxy(
  new router.AutouserRouter({
    gaTrackingId: process.env.SHINY_GAID
  }),
  new WorkerRegistry(),
  {}
);
shinyProxy.httpServer.listen(
  parseInt(process.env.SHINY_PORT || 80),
  process.env.SHINY_HOST);
