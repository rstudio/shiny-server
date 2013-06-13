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
var fs = require('fs');
var net = require('net');
var map = require('../core/map');
var crypto = require('crypto');
var path = require('path');
var moment = require('moment');
var util = require('util');
var Q = require('q');
var _ = require('underscore');
require('../core/log');
var AppWorkerHandle = require('../worker/app-worker-handle');
var app_worker = require('../worker/app-worker');

var Scheduler = function() {
  this.$workers = map.create();
};
module.exports = Scheduler;

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

(function() {
  this.spawnWorker_p = function(appSpec, workerData){
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
      var workerPromise = app_worker.launchWorker_p(appSpec, listenPort, logFilePath, workerId);
      
      var exitPromise = workerPromise.invoke('getExit_p');
      exitPromise
      .fin(function() {
        delete self.$workers[key][workerId];
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

        // TODO: Interval and timeout should be configurable
        var connectPromise = connect_p('127.0.0.1', listenPort, 500, 60000,
          _.bind(exitPromise.isPending, exitPromise));

        connectPromise.then(function() {
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
            _.pick(worker.promise.valueOf(), 'appSpec', 'port', 'logFilePath'),
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