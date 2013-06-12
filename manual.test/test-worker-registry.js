var util = require('util');
require('../lib/core/log')
var AppSpec = require('../lib/worker/app-spec');
var WorkerRegistry = require('../lib/worker/worker-registry');

var registry = new WorkerRegistry();
registry.getWorker_p(new AppSpec(
  '/Users/jcheng/ShinyApps/diamonds', 'jcheng', '', null, {}))
.then(function(info) {
  logger.info(util.inspect(info));
})
.done();

registry.getWorker_p(new AppSpec(
  '/Users/jcheng/ShinyApps/diamonds', 'jcheng', '', null, {}))
.then(function(info) {
  logger.info(util.inspect(info));
})
.done();
