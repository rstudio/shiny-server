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
      logger.trace('Reusing existing instance');
      return Q.resolve(this.$workers[key]);
    }

    var defer = Q.defer();
    this.$workers[key] = defer.promise;

    try {
      var listenPort = this.allocPort();
      var logFilePath = this.getLogFilePath(appSpec);
      logger.trace('Launching ' + appSpec.appDir + ' as ' + appSpec.runAs +
        ' on port ' + listenPort);
      var workerPromise = app_worker.launchWorker_p(appSpec, listenPort, logFilePath);
      var exitPromise = workerPromise.invoke('getExit_p');
      exitPromise.fin(function() {
        delete self.$workers[key];
        self.freePort(listenPort);
        logger.trace('Port ' + listenPort + ' returned');
      });

      var appWorkerInfo = new AppWorkerInfo(appSpec, listenPort, logFilePath, exitPromise);

      workerPromise.then(
        function(appWorker) {
          
          var delayedReleaseTimerId = null;
          appWorkerInfo.on('release', function(refCount) {
            if (refCount === 0) {
              delayedReleaseTimerId = setTimeout(function() {
                logger.trace('Interrupting process on port ' + listenPort);
                appWorker.kill('SIGINT');
              }, 5000);
            }
          });
          appWorkerInfo.on('acquire', function(refCount) {
            clearTimeout(delayedReleaseTimerId);
            delayedReleaseTimerId = null;
          });

          setTimeout(function() {
            // TODO: Actually verify that we can connect before resolving
            if (exitPromise.isResolved())
              defer.reject(new Error('Early termination'));
            else
              defer.resolve(appWorkerInfo);
          }, 1000);
        },
        function(err) {
          defer.reject(e);
        }
      ).done();
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