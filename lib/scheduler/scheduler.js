/*
 * scheduler.js
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
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const events = require('events');
const net = require('net');
const map = require('../core/map');
const path = require('path');
const moment = require('moment');
const util = require('util');
const Q = require('q');
const _ = require('underscore');
require('../core/log');
const fsutil = require('../core/fsutil');
const AppWorkerHandle = require('../worker/app-worker-handle');
// can't use const for app_worker because test/scheduler.js uses rewire to mock
let app_worker = require('../worker/app-worker');
const posix = require('../../build/Release/posix');
const WorkerEntry = require('./worker-entry');

/**
 * @param appSpec the appSpec associated
 * with this scheduler. Will be used to identify the scheduler if/when it 
 * runs out of workers and needs to be terminated.
 */
var Scheduler = function(eventBus, appSpec) {
  events.EventEmitter.call(this);

  this.$eventBus = eventBus;
  this.$workers = map.create();
  this.$appSpec = appSpec;
};
Scheduler.prototype.__proto__ = events.EventEmitter.prototype;

module.exports = Scheduler;

// Attempt to connect to the endpoint, but don't take longer than `timeout`.
// The shouldContinue callback can be used to short-circuit waiting (in case
// the caller learns some other way that the connect will never succeed, i.e.
// the process we're trying to connect to has exited).
//
// On success, the promise resolves to true.
// On timeout, the promise is rejected with an error.
// On shouldContinue() == false, the promise is rejected with an error.
function connectEndpoint_p(endpoint, timeout, shouldContinue) {
  var deferred = Q.defer();

  // Retry using increasing intervals; when we use them all, use maxInterval
  var intervals = [50, 50, 100, 100, 100, 100, 100, 200, 200, 300, 300, 300];
  var maxInterval = 500;
  
  // The previously used interval
  var lastInterval = 0;
  var elapsed = 0;
  var timeoutId = null;

  attemptToConnect();

  // Represents a single attempt to connect. If it fails, will try again later
  // unless the elapsed time exceeds the timeout we were given.
  function attemptToConnect() {
    elapsed += lastInterval;

    if (elapsed > timeout) {
      logger.trace('Giving up on connecting to ' + endpoint.toString());
      deferred.reject(new Error('The application took too long to respond.'));
      return;
    }
    if (!deferred.promise.isPending()) {
      return;
    }
    if (!shouldContinue()) {
      logger.trace('Aborting connection attempts to ' + endpoint.toString());
      deferred.reject(new Error('Connection attempt was aborted.'));
      return;
    }

    logger.trace('Attempting to connect to ' + endpoint.toString());
    endpoint.connect_p()
    .then(function(connected) {
      if (connected) {
        logger.trace('Successfully connected to ' + endpoint.toString() +
          ' after ' + elapsed + 'ms');
        clearTimeout(timeoutId);
        deferred.resolve(true);
        return;
      } else {
        logger.trace('Failed to connect to ' + endpoint.toString());
      }
    })
    .eat();

    lastInterval = intervals.shift() || maxInterval;
    setTimeout(attemptToConnect, lastInterval);
  }

  return deferred.promise;
}

(function() {
  this.setTransport = function(transport) {
    this.$transport = transport;
  };

  /**
   * @param preemptive true if we're creating this worker before we're actually
   * allocating a request to it. false if we're creating this request as we 
   * allocate a request to it. This is needed to maintain a proper count of
   * how many connections are active for a worker.
   */
  this.spawnWorker = function(appSpec, workerData, preemptive){
    var self = this;

    var defer = Q.defer();

    var idleTimeout = 5 * 1000;
    if (appSpec.settings.appDefaults && (appSpec.settings.appDefaults.idleTimeout || appSpec.settings.appDefaults.idleTimeout === 0)){
      idleTimeout = appSpec.settings.appDefaults.idleTimeout * 1000;

      if (idleTimeout > Math.pow(2,31) - 1) {
        // Node currently only supports 32-bit setTimeouts
        // http://stackoverflow.com/questions/16314750/settimeout-fires-immediately-if-the-delay-more-than-2147483648-milliseconds
        logger.warn('Idle timeout value "' + appSpec.settings.appDefaults.idleTimeout + '" too high. Using the maximum of 2147483 seconds instead. Consider using a negative value if you want to disable the timeout altogether.');
        idleTimeout = Math.pow(2,31) - 1;
      }
    }

    let workerEntry = new WorkerEntry(defer.promise, workerData || map.create(), idleTimeout);
    let workerId = workerEntry.id;
    this.$workers[workerId] = workerEntry;

    var logFilePath = null;
    var doReject = function(err) {
      err.consoleLogFile = logFilePath;
      if (self.$workers[workerId]) {
        logger.trace("Subprocess failed to start, removing worker entry");
        delete self.$workers[workerId];
      }
      defer.reject(err);
    };
    // Once defer is fulfilled, doReject is essentially a no-op. The following
    // (making doReject *actually* a no-op) may seem redundant, but it is
    // necessary to prevent a memory leak!
    // jcheng 8/22/2013: I'm not sure we still need this; the leak might have
    // been because connectEndpoint_p (er, its predecessor) did not resolve or
    // reject the deferred when shouldContinue was false.
    defer.promise
    .fin(function() {
      doReject = function() {};
    })
    .eat();

    this.$transport.alloc_p()
    .then(function(endpoint) {

      logFilePath = self.getLogFilePath(appSpec, endpoint);
      if (!appSpec.runAs)
        throw new Error("No user specified");

      var pw = posix.getpwnam(appSpec.runAs);

      var deleteLogFileOnExit = false;
      logger.trace('Launching ' + appSpec.appDir + ' as ' + appSpec.runAs +
        ' with on ' + endpoint.toString());
      var workerPromise = app_worker.launchWorker_p(
        appSpec, pw, endpoint, logFilePath, workerId);
      
      var exitPromise = workerPromise.invoke('getExit_p');
      exitPromise
      .fin(function() {
        if (self.$workers[workerId]) {
          self.$workers[workerId].close();
        }
        delete self.$workers[workerId];
        if (_.size(self.$workers) === 0) {
          // There aren't any workers left, kill this scheduler.
          self.$eventBus.emit('vacantSched', self.$appSpec.getKey());
        }
        endpoint.free();
        logger.trace(endpoint.ToString() + ' returned');
      })
      .then(function(status) {
        if (deleteLogFileOnExit) {
          if (logFilePath === '/dev/null'){
            logger.trace("Refusing to delete /dev/null.");
            return;
          }

          if (!appSpec.settings || !appSpec.settings.appDefaults || 
              !appSpec.settings.appDefaults.preserveLogs){
            logger.trace('Normal exit, deleting log file ' + logFilePath);

            if(appSpec.logAsUser){
              var rm = child_process.spawn("rm", [logFilePath], 
                {uid: pw.uid, gid: pw.gid});
              rm.on('close', function (code) {
                if (code != 0){
                  logger.warn('Failed to delete log file ' + logFilePath + ': exit code ' + code);
                }
              });
            } else {
              fs.unlink(logFilePath, function(err){
                if (err){
                  logger.warn('Failed to delete log file ' + logFilePath + ': ' + err.message);
                }
              });
            }

          } else {
            logger.trace('Declining to delete log file of successful execution: ' + logFilePath);
          }
        }
      })
      .eat();

      return workerPromise.then(function(appWorker) {
        var appWorkerHandle = new AppWorkerHandle(appSpec, endpoint,
          logFilePath, exitPromise,
          _.bind(appWorker.kill, appWorker));

        workerEntry.on("idletimeout", () => {
          logger.trace("Timeout expired. Killing process.");
          deleteLogFileOnExit = true;
          if (!appWorker.isRunning()) {
            logger.trace('Process on ' + endpoint.toString() + ' is already gone');
          } else {
            logger.trace('Interrupting process on socket ' + endpoint.toString());
            try {
              appWorker.kill();
            } catch (err) {
              logger.error('Failed to kill process on ' + endpoint.toString() + ': ' + err.message);
            }
          }
        });

        var initTimeout = 60 * 1000;
        if (appSpec.settings.appDefaults && appSpec.settings.appDefaults.initTimeout){
          initTimeout = appSpec.settings.appDefaults.initTimeout * 1000;
        }
        
        var connectPromise = connectEndpoint_p(endpoint,
            initTimeout, _.bind(exitPromise.isPending, exitPromise));

        connectPromise
        .then(function() {
          // Trigger the idle timer to ensure that this worker doesn't spin up,
          // never get used, and run indefinitely.
          workerEntry.startIdleTimer();

          return defer.resolve(appWorkerHandle);
          },
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

    return workerEntry;
  };

  this.getLogFilePath = function(appSpec, endpoint) {
    if (!appSpec.logDir)
      return '/dev/null'; // TODO: Windows-compatible equivalent?

    var timestamp = moment().format('YYYYMMDD-HHmmss');
    var filename = path.basename(appSpec.appDir) + '-' +
      appSpec.runAs + '-' + timestamp + '-' + endpoint.getLogFileSuffix() +
      '.log';
    return path.join(appSpec.logDir, filename);
  };

  this.shutdown = function() {
    return _.each(_.values(this.$workers), function(worker) {
      if (worker.promise.isFulfilled()) {
        try {
          worker.promise.inspect().value.kill();
        } catch (err) {
          logger.error('Failed to kill process: ' + err.message);
        }
      }
    });
  };

  function summarizeWorker(worker) {
    return {
      appSpec: worker.appSpec,
      endpoint: worker.endpoint.ToString(),
      logFilePath: worker.logFilePath
    };
  }

  this.dump = function() {
    logger.info('Dumping up to ' + _.size(this.$workers) + ' worker(s)');
    _.each(_.values(this.$workers), function(worker) {
      if (worker.promise.isFulfilled()) {
        console.log(util.inspect(summarizeWorker(worker.promise.inspect().value),
          false, null, true
        ));
      }
      else {
        console.log('[unresolved promise]');
      }
    });
    logger.info('Dump completed')
  };
}).call(Scheduler.prototype);
