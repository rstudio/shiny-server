var util = require('util');
var AppSpec = require('../lib/worker/app-spec');
var app_worker = require('../lib/worker/app-worker');

var rw_p = app_worker.runWorker_p(new AppSpec(
  '/Users/jcheng/ShinyApps/diamonds', 'jcheng', '', null, {}),
  '/tmp/test-app-worker.sock', './testlog.log');

rw_p
.then(
  function(status) {
    console.log('exit with status: ' + util.inspect(status));
  },
  function(err) {
    console.log('err: ' + err);
  }
);
