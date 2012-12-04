var proxy = require('../lib/proxy/proxy');
var router = require('../lib/router/router')
var WorkerRegistry = require('../lib/worker/worker-registry');

var shinyProxy = new proxy.ShinyProxy(
  new router.DummyRouter('/Users/jcheng/ShinyApps/diamonds', 'jcheng'),
  new WorkerRegistry(),
  {}
);
shinyProxy.httpServer.listen(8001);
