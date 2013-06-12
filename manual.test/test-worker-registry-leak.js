var util = require('util');
require('../lib/core/log')
var fs = require('fs');
var AppSpec = require('../lib/worker/app-spec');
var WorkerRegistry = require('../lib/worker/worker-registry');

SHINY_SERVER_VERSION = "0.3.4";

var registry = new WorkerRegistry();
setInterval(function() {
  registry.getWorker_p(new AppSpec(
    '/var/shiny-server/www/09_upload', 'shiny', '', '/var/shiny-server/log', {
      random: process.uptime()
    }))
  .then(function(info) {
    info.acquire();
    info.release();
  })
  .done();

  return true;
}, 100);

agent = require('webkit-devtools-agent')

setInterval(function() {
  var mu = process.memoryUsage();
  var info = process.uptime() + ',' + mu.rss + ',' + mu.heapTotal + ',' + mu.heapUsed + '\n';
  fs.appendFile('mem-' + process.pid + '.csv', info);
  return true;
}, 3000);