/*
 * worker-registry.js
 *
 * Copyright (C) 2009-13 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
var fs = require('fs');
var net = require('net');
var path = require('path');
var moment = require('moment');
var util = require('util');
var Q = require('q');
var _ = require('underscore');
require('../core/log');
var map = require('../core/map');
var AppWorkerHandle = require('./app-worker-handle');
var app_worker = require('./app-worker');


function connect_p(host, port, interval, timeout, shouldContinue) {
  var defer = Q.defer();

  var elapsed = 0;
  var intervalId = setInterval(function() {
    elapsed += interval;
    if (elapsed > timeout) {
      logger.trace('Giving up on connecting to port ' + port);
      defer.reject(new Error('The application took too long to respond.'));
      clearInterval(intervalId);
      return;
    }
    if (!defer.promise.isPending()) {
      clearInterval(intervalId);
      return;
    }
    if (!shouldContinue()) {
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
  this.$workers = map.create();
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

    var logFilePath = null;
    var doReject = function(err) {
      err.consoleLogFile = logFilePath;
      defer.reject(err);
    };
    // Once defer is fulfilled, doReject is essentially a no-op. The following
    // (making doReject *actually* a no-op) may seem redundant, but it is
    // necessary to prevent a memory leak!
    defer.promise
    .fin(function() {
      doReject = function() {};
    })
    .eat();

    this.allocPort_p()
    .then(function(listenPort) {

      logFilePath = self.getLogFilePath(appSpec, listenPort);

      var deleteLogFileOnExit = false;
      logger.trace('Launching ' + appSpec.appDir + ' as ' + appSpec.runAs +
        ' on port ' + listenPort);
      var workerPromise = app_worker.launchWorker_p(appSpec, listenPort, logFilePath);
      
      var exitPromise = workerPromise.invoke('getExit_p');
      exitPromise
      .fin(function() {
        delete self.$workers[key];
        self.freePort(listenPort);
        logger.trace('Port ' + listenPort + ' returned');
      })
      .then(function(status) {
        if (deleteLogFileOnExit) {
          logger.trace('Normal exit, deleting log file ' + logFilePath);
          fs.unlink(logFilePath, function(err) {
            if (err)
              logger.warn('Failed to delete log file ' + logFilePath + ': ' + err.message);
          });
        }
      })
      .eat();

      return workerPromise.then(function(appWorker) {
        var appWorkerHandle = new AppWorkerHandle(appSpec, listenPort, logFilePath, exitPromise,
          _.bind(appWorker.kill, appWorker));

        // Hook up acquire/release behavior.
        var delayedReleaseTimerId = null;
        appWorkerHandle.on('acquire', function(refCount) {
          clearTimeout(delayedReleaseTimerId);
          delayedReleaseTimerId = null;
        });
        appWorkerHandle.on('release', function(refCount) {
          if (refCount === 0) {
            delayedReleaseTimerId = setTimeout(function() {
              deleteLogFileOnExit = true;
              if (!appWorker.isRunning()) {
                logger.trace('Process on port ' + listenPort + ' is already gone');
              } else {
                logger.trace('Interrupting process on port ' + listenPort);
                try {
                  appWorker.kill();
                } catch (err) {
                  logger.error('Failed to kill process on port ' + listenPort + ': ' + err.message);
                }
              }
            }, 5000);
          }
        });

        // TODO: Interval and timeout should be configurable
        var connectPromise = connect_p('127.0.0.1', listenPort, 500, 60000,
          _.bind(exitPromise.isPending, exitPromise));

        connectPromise.then(
          _.bind(defer.resolve, defer, appWorkerHandle),
          doReject
        )
        .done();

        exitPromise.fin(function() {
          doReject(new Error('The application exited during initialization.'));
        })
        .eat();
      });
    })
    .fail(function(error) {
      doReject(error);
    })
    .done();

    return defer.promise;
  };

  /**
   * Return a port number that we believe to be unused. When finished, call
   * freePort to make the port available again.
   *
   * (Actually this implementation lets the OS pick a random port, and then
   * checks if the port is in use. If so, it retries. It's not actually
   * necessary to use freePort with this implementation but it seems like
   * a good idea to keep that discipline in case we later need to switch
   * to a preallocated list of ports for some reason.)
   */
  this.allocPort_p = function(/* tries */) {
    var self = this;
    var defer = Q.defer();

    var tries = arguments.length > 0 ? arguments[0] : 0;

    try {
      var server = net.createServer(function(conn) {conn.destroy();});
      server.on('error', function(e) {
        
        try {
          server.close();
        } catch (closeErr) {
        }

        try {
          if (e.code == 'EADDRINUSE') {
            logger.info('Could not bind port: ' + e.message);
            if (tries == 5) {
              logger.error('Giving up on binding port after 5 tries');
              defer.reject(new Error("Couldn't find a free port"));
            } else {
              defer.resolve(self.allocPort_p(tries+1));
            }
          } else {
            defer.reject(e);
          }
        } catch (err) {
          defer.reject(err);
        }
      })
      server.listen(0, '127.0.0.1', function() {
        var port = server.address().port;
        server.close();
        defer.resolve(port);
      });
    } catch (ex) {
      defer.reject(ex);
    }


    return defer.promise;
  };

  this.freePort = function(port) {
    // This space intentionally left blank
  };

  this.getLogFilePath = function(appSpec, listenPort) {
    if (!appSpec.logDir)
      return '/dev/null'; // TODO: Windows-compatible equivalent?

    var timestamp = moment().format('YYYYMMDD-HHmmss');
    var filename = path.basename(appSpec.appDir) + '-' +
      appSpec.runAs + '-' + timestamp + '-' + listenPort + '.log';
    return path.join(appSpec.logDir, filename);
  };

  this.shutdown = function() {
    return _.each(_.values(this.$workers), function(promise) {
      if (promise.isFulfilled()) {
        try {
          promise.valueOf().kill();
        } catch (err) {
          logger.error('Failed to kill process: ' + err.message);
        }
      }
    });
  };

  this.dump = function() {
    logger.info('Dumping up to ' + _.size(this.$workers) + ' worker(s)');
    _.each(_.values(this.$workers), function(promise) {
      if (promise.isFulfilled()) {
        console.log(util.inspect(
          _.pick(promise.valueOf(), 'appSpec', 'port', 'logFilePath'),
          false, null, true
        ));
      }
      else {
        console.log('[unresolved promise]');
      }
    });
    logger.info('Dump completed')
  };

}).call(WorkerRegistry.prototype);