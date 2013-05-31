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
var crypto = require('crypto');
var fs = require('fs');
var net = require('net');
var os = require('os');
var path = require('path');
var moment = require('moment');
var util = require('util');
var Q = require('q');
var _ = require('underscore');
require('../core/log');
var map = require('../core/map');
var fsutil = require('../core/fsutil');
var AppWorkerHandle = require('./app-worker-handle');
var app_worker = require('./app-worker');

function connectDomainSocket_p(sockName, socketPath, interval, timeout,
      shouldContinue) {
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

var WorkerRegistry = function() {
  this.$workers = map.create();
};
module.exports = WorkerRegistry;

(function() {

  this.setSocketDir = function(socketDir) {
    if (!socketDir) {
      socketDir = path.join(os.tmpdir(), 'shiny-session');
    }

    this.$socketDir = socketDir;
    logger.info('Socket dir: ' + socketDir);
    if (!fsutil.directoryExistsSync(socketDir)) {
      logger.info('Socket dir does not exist, will create it');
      fs.mkdirSync(socketDir, 0733);
      // Not sure why but mkdirSync's mode parameter doesn't have the desired
      // effect. Do a chmodSync to ensure the perms get set correctly.
      fs.chmodSync(socketDir, 0733);
    }
  };

  this.getSockPath = function(sockName) {
    return path.join(this.$socketDir, sockName + '.sock');
  };

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
        ' with name ' + sockName);
      var workerPromise = app_worker.launchWorker_p(appSpec, socketPath, logFilePath);

      var exitPromise = workerPromise.invoke('getExit_p');
      exitPromise
      .fin(function() {
        delete self.$workers[key];
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
                logger.trace('Process on socket ' + sockName + ' is already gone');
              } else {
                logger.trace('Interrupting process on socket ' + sockName);
                try {
                  appWorker.kill();
                } catch (err) {
                  logger.error('Failed to kill process on socket ' + sockName + ': ' + err.message);
                }
              }
            }, 5000);
          }
        });

        // TODO: Interval and timeout should be configurable
        var connectPromise = connectDomainSocket_p(sockName, socketPath,
          500, 60000, _.bind(exitPromise.isPending, exitPromise));

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
          _.pick(promise.valueOf(), 'appSpec', 'sockName', 'logFilePath'),
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