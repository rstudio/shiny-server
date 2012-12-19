var proxy_http = require('../lib/proxy/http');
var proxy_sockjs = require('../lib/proxy/sockjs');
var router = require('../lib/router/router')
var WorkerRegistry = require('../lib/worker/worker-registry');

var rout = new router.AutouserRouter();
var workers = new WorkerRegistry();

var shinyProxy = new proxy_http.ShinyProxy(
  rout,
  workers,
  {}
);
proxy_sockjs.createServer(rout, workers).installHandlers(shinyProxy.httpServer);
shinyProxy.httpServer.listen(8001);
