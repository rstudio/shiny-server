var net = require('net');
var Q = require('q');
var _ = require('underscore');
require('../core/log');
var AppWorkerHandle = require('./app-worker-handle');
var app_worker = require('./app-worker');


function connect_p(host, port, interval, timeout, shouldStop) {
  var defer = Q.defer();

  var elapsed = 0;
  var intervalId = setInterval(function() {
    elapsed += interval;
    if (elapsed > timeout) {
      logger.trace('Giving up on connecting to port ' + port);
      defer.reject(new Error('Timeout'));
      clearInterval(intervalId);
      return;
    }
    if (defer.promise.isResolved()) {
      clearInterval(intervalId);
      return;
    }
    if (shouldStop()) {
      clearInterval(intervalId);
      return;
    }

    logger.trace('Attempting to connect to port ' + port);
    var client = net.connect(port, host, function() {
      logger.trace('Successfully connected to port ' + port);
      clearInterval(intervalId);
      defer.resolve(true);
      client.destroy();
      return;
    });
    client.on('error', function(err) {
      logger.trace('Failed to connect to port ' + port);
      client.destroy();
    });
  }, interval);

  return defer.promise;
}


var WorkerRegistry = function() {
  this.$workers = {};
};
module.exports = WorkerRegistry;

(function() {

  /**
   * Asynchronously retrieves an already-existant worker or attempts to create
   * a new one, and returns a promise for the AppWorkerHandle.
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

      var appWorkerHandle = new AppWorkerHandle(appSpec, listenPort, logFilePath, exitPromise);

      workerPromise.then(
        function(appWorker) {
          
          // Hook up acquire/release behavior.
          var delayedReleaseTimerId = null;
          appWorkerHandle.on('acquire', function(refCount) {
            clearTimeout(delayedReleaseTimerId);
            delayedReleaseTimerId = null;
          });
          appWorkerHandle.on('release', function(refCount) {
            if (refCount === 0) {
              delayedReleaseTimerId = setTimeout(function() {
                logger.trace('Interrupting process on port ' + listenPort);
                appWorker.kill('SIGINT');
              }, 5000);
            }
          });

          // TODO: Interval and timeout should be configurable
          var connectPromise = connect_p('127.0.0.1', listenPort, 500, 60000,
            _.bind(exitPromise.isResolved, exitPromise));

          connectPromise.then(
            _.bind(defer.resolve, defer, appWorkerHandle),
            _.bind(defer.reject, defer));
          exitPromise.fin(defer.reject);
        },
        function(err) {
          defer.reject(err);
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