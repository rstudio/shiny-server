var Q = require('q');
require('../core/log');
var AppWorkerInfo = require('./app-worker-info');
var app_worker = require('./app-worker');

var WorkerRegistry = function() {
  this.$workers = {};
};
module.exports = WorkerRegistry;

(function() {

  /**
   * Asynchronously retrieves an already-existant worker or attempts to create
   * a new one, and returns a promise for the AppWorkerInfo.
   *
   * In the future when we have different application-to-process mapping
   * policies, this will be the primary place where different strategies will
   * be invoked.
   *
   * @param {AppSpec} appSpec - Contains the basic details about the app to
   *   launch
   */
  this.getWorker_p = function(appSpec) {
    var self = this;

    var key = appSpec.getKey();
    if (this.$workers[key]) {
      logger.info('Reusing existing instance');
      return Q.resolve(this.$workers[key]);
    }

    var defer = Q.defer();
    this.$workers[key] = defer.promise;

    try {
      var listenPort = this.allocPort();
      var logFilePath = this.getLogFilePath(appSpec);
      logger.info('Launching ' + appSpec.appDir + ' as ' + appSpec.runAs +
        ' on port ' + listenPort);
      var exitPromise = app_worker.runWorker_p(appSpec, listenPort, logFilePath);
      exitPromise.fin(function() {
        self.freePort(listenPort);
        logger.info('Port ' + listenPort + ' returned');
      });
      var appWorkerInfo = new AppWorkerInfo(appSpec, listenPort, logFilePath, exitPromise);
      defer.resolve(appWorkerInfo);
    }
    catch (e) {
      defer.reject(e);
    }

    return defer.promise;
  };

  /**
   * Return a port number that we believe to be unused. When finished, call
   * freePort to make the port available again.
   */
  this.allocPort = function() {
    // TODO: Implement correctly
    return 9000 + Math.floor(Math.random() * 1000);
  };
  this.freePort = function(port) {
    // TODO: Implement correctly
  };

  this.getLogFilePath = function(appSpec) {
    // TODO: Implement
    return '/dev/null';
  };

}).call(WorkerRegistry.prototype);