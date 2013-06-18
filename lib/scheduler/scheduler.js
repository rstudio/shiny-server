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
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var net = require('net');
var map = require('../core/map');
var crypto = require('crypto');
var path = require('path');
var moment = require('moment');
var util = require('util');
var Q = require('q');
var _ = require('underscore');
require('../core/log');
var fsutil = require('../core/fsutil');
var AppWorkerHandle = require('../worker/app-worker-handle');
var app_worker = require('../worker/app-worker');

var Scheduler = function() {
  this.$workers = map.create();
};
module.exports = Scheduler;

function connectDomainSocket_p(sockName, socketPath, interval, timeout, shouldContinue) {
  var defer = Q.defer();

  var elapsed = 0;
  var intervalId = setInterval(function() {
    elapsed += interval;
    if (elapsed > timeout) {
      logger.trace('Giving up on connecting to socket ' + sockName);
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

    logger.trace('Attempting to connect to socket ' + sockName);
    var client = net.connect(socketPath, function() {
      logger.trace('Successfully connected to socket ' + sockName);
      clearInterval(intervalId);
      defer.resolve(true);
      client.destroy();
      return;
    });
    client.on('error', function(err) {
      logger.trace('Failed to connect to socket ' + sockName);
      client.destroy();
    });
  }, interval);

  return defer.promise;
}

(function() {
  this.setSocketDir = function(socketDir) {
    this.$socketDir = socketDir;
  };

  this.getSockPath = function(sockName) {
    if (!this.$socketDir){
      throw new Error('Socket directory has not yet been set.');
    }
    return path.join(this.$socketDir, sockName + '.sock');
  }; 


  /**
   * @param preemptive true if we're creating this worker before we're actually
   * allocating a request to it. false if we're creating this request as we 
   * allocate a request to it. This is needed to maintain a proper count of
   * how many connections are active for a worker.
   */
  this.spawnWorker_p = function(appSpec, workerData, preemptive){
    var self = this;
    var key = appSpec.getKey();

    // Because appSpec will no longer uniquely identify a worker, assign a
    // random ID to each worker for addressing purposes.
    var workerId = crypto.randomBytes(8).toString('hex');

    var defer = Q.defer();
    if (!this.$workers[key]){
      this.$workers[key] = {};
    }

    this.$workers[key][workerId] = { 
      promise : defer.promise, 
      data : workerData || map.create()
    }

    //initialize open connections counters.
    this.$workers[key][workerId].data['sockConn'] = 0;
    this.$workers[key][workerId].data['httpConn'] = 0;
    this.$workers[key][workerId].data['pendingConn'] = 0;
    if (!preemptive){
      this.$workers[key][workerId].data['pendingConn']++;
    }

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

    this.createSockName_p()
    .then(function(sockFullName) {

      // socketPath will be the actual path that is used for the domain socket.
      var socketPath = self.getSockPath(sockFullName);

      // sockName is a shortened version of sockFullName that is used for
      // logging/diagnostic purposes. It is shortened from the full name so the
      // logs can't be used to figure out the full socket path.
      var sockName = sockFullName.substring(0, 12);

      // sockFullName is no longer needed, remove it so we don't use it
      // accidentally
      delete sockFullName;

      logFilePath = self.getLogFilePath(appSpec, sockName);

      var deleteLogFileOnExit = false;
      logger.trace('Launching ' + appSpec.appDir + ' as ' + appSpec.runAs +
        ' with name  ' + sockName);
      var workerPromise = app_worker.launchWorker_p(
        appSpec, socketPath, logFilePath, workerId);
      
      var exitPromise = workerPromise.invoke('getExit_p');
      exitPromise
      .fin(function() {
        delete self.$workers[key][workerId];
        self.freeSock(sockName);
        logger.trace('Socket ' + sockName + ' returned');
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
        var appWorkerHandle = new AppWorkerHandle(appSpec, sockName,
            socketPath, logFilePath, exitPromise,
           _.bind(appWorker.kill, appWorker));

        var initTimeout = 60000;

        // TODO: Interval and timeout should be configurable
        var connectPromise = connectDomainSocket_p(sockName, socketPath,
            500, initTimeout, _.bind(exitPromise.isPending, exitPromise));

        connectPromise
        .then(function() {
          /**
           * Supplement the workerHandle with acquire and release functions.
           */
          (function() {
            this.acquire = function(type){
              if(type == 'http'){
                self.$workers[key][workerId].data['httpConn']++;
              } else if(type == 'sock'){
                self.$workers[key][workerId].data['sockConn']++;
              } else{
                new Error('Unrecognized type to be acquired: "' + type + '"');
              }

              //We just realized a pending connection. Decrement the counter.
              if (self.$workers[key][workerId].data.pendingConn > 0){
                self.$workers[key][workerId].data.pendingConn--;
              }

              logger.trace('Worker #'+workerId+' acquiring '+type+' port. ' + 
                self.$workers[key][workerId].data['httpConn'] + ' open HTTP connection(s), ' + 
                self.$workers[key][workerId].data['sockConn'] + ' open WebSocket connection(s).')

              //clear the timer to ensure this process doesn't get destroyed.
              var timerId = self.$workers[key][workerId].data['timer'];
              if (timerId){
                clearTimeout(timerId);                
                self.$workers[key][workerId].data['timer'] = null;
              }              
            };
            
            var idleTimeout = 5000;

            this.release = function(type){
              if(type == 'http'){
                self.$workers[key][workerId].data['httpConn']--;
              } else if(type == 'sock'){
                self.$workers[key][workerId].data['sockConn']--;
              } else{
                new Error('Unrecognized type to be released: "' + type + '"');
              }

              logger.trace('Worker #'+workerId+' releasing '+type+' port. ' + 
                self.$workers[key][workerId].data['httpConn'] + ' open HTTP connection(s), ' + 
                self.$workers[key][workerId].data['sockConn'] + ' open WebSocket connection(s).')
              
              if (self.$workers[key][workerId].data['sockConn'] + 
                    self.$workers[key][workerId].data['httpConn'] === 0) {
                
                logger.trace("No clients connected to worker #" + workerId + ". Starting timer");
                self.$workers[key][workerId].data['timer'] = setTimeout(function() {
                  logger.trace("Timeout expired. Killing process.");
                  deleteLogFileOnExit = true;
                  if (!appWorker.isRunning()) {
                    logger.trace('Process on socket ' + sockName + ' is already gone');
                  } else {
                    logger.trace('Interrupting process on socket ' + sockName);
                    try {
                      appWorker.kill();
                    } catch (err) {
                      logger.error('Failed to kill process on socket ' + sockName + ': ' + err.message);
                    }
                  }
                }, idleTimeout);
              }
            
            };

          }).call(appWorkerHandle);


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

    return defer.promise;
  };

  /**
   * Return a random name. This will be part of the domain socket name.
   */ 
   this.createSockName_p = function() {
    return Q.nfcall(crypto.randomBytes, 16)
    .then(function(buf) {
      return buf.toString('hex');
    }); 
  };

  this.freeSock = function(sockName) {
    // This space intentionally left blank
  };

  this.getLogFilePath = function(appSpec, sockName) {
    if (!appSpec.logDir)
      return '/dev/null'; // TODO: Windows-compatible equivalent?

    var timestamp = moment().format('YYYYMMDD-HHmmss');
    var filename = path.basename(appSpec.appDir) + '-' +
      appSpec.runAs + '-' + timestamp + '-' + sockName + '.log';
    return path.join(appSpec.logDir, filename);
  };

  this.shutdown = function() {
    return _.each(_.values(this.$workers), function(app) {
      _.each(_.values(app), function(worker) {
        if (worker.promise.isFulfilled()) {
          try {
            worker.promise.valueOf().kill();
          } catch (err) {
            logger.error('Failed to kill process: ' + err.message);
          }
        }
      });
    });
  };

  this.dump = function() {
    logger.info('Dumping up to ' + _.size(this.$workers) + ' app(s)');
    _.each(_.values(this.$workers), function(app) {
      logger.info('Dumping up to ' + _.size(app) + ' workers(s) for this app.');
      _.each(_.values(app), function(worker) {
        if (worker.promise.isFulfilled()) {
          console.log(util.inspect(
            _.pick(worker.promise.valueOf(), 'appSpec', 'sockName', 'logFilePath'),
            false, null, true
          ));
        }
        else {
          console.log('[unresolved promise]');
        }
      });
    });
    logger.info('Dump completed')
  };
}).call(Scheduler.prototype);