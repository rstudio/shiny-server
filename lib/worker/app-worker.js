/*
 * app-worker.js
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

/**
 * An AppWorker is responsible for:
 *
 * - Launching a Shiny application with the proper user/group permissions
 * - Ensuring that stderr is written to the specified path
 * - Returning a promise that resolves when the worker process exits
 */

var child_process = require('child_process');
var fs = require('fs');
var path = require('path');
var util = require('util');
var bash = require('bash');
var Q = require('q');
var _ = require('underscore');
var posix = require('../../build/Release/posix');

var rprog = process.env.R || 'R';
var scriptPath = path.normalize(__dirname + '/../../R/SockJSAdapter.R');

function exists_p(path) {
  var defer = Q.defer();
  fs.exists(path, function(exists) {
    defer.resolve(exists);
  });
  return defer.promise;
}

/**
 * Begins launching the worker; returns a promise that resolves when
 * the worker is constructed (doesn't necessarily mean the process has
 * actually begun running though).
 *
 * @param {AppSpec} appSpec - Contains the basic details about the app to
 *   launch
 * @param {String} socketPath - The socket path the Shiny app should
 *   listen on.
 * @param {String} logFilePath - The file path to write stderr to.
 */
function launchWorker_p(appSpec, socketPath, logFilePath, workerId) {
  
  if (!appSpec.runAs)
    return Q.reject(new Error("No user specified"));

  var pw = posix.getpwnam(appSpec.runAs);
  if (!pw)
    return Q.reject(new Error("User " + appSpec.runAs + " does not exist"));

  if (!appSpec.appDir)
    return Q.reject(new Error("No app directory specified"));


  return exists_p(appSpec.appDir).then(function(exists) {
    if (!exists) {
      var err = new Error("App dir " + appSpec.appDir + " does not exist");
      err.code = 'ENOTFOUND';
      throw err;
    }
    
    // Open the log file asynchronously, then create the worker
    return Q.nfcall(fs.open, logFilePath, 'a', 0660).then(function(logStream) {
      fs.fchown(logStream, pw.uid, pw.gid, function(err) {
        if (err)
          logger.error('Error attempting to change permissions on log file at ' + logFilePath + ': ' + err.message);
      });

      // Create the worker; when it exits (or fails to start), close
      // the logStream.
      var worker = new AppWorker(appSpec, socketPath, logStream, workerId);
      worker.getExit_p()
      .fin(function() {
        fs.close(logStream, function(err) {
          if (err)
            logger.error("Couldn't close logStream: " + err.message);
        });
      })
      .eat();

      return worker;
    });
  });
};
exports.launchWorker_p = launchWorker_p;

/**
 * Like launchWorker_p, but the promise it returns doesn't resolve until
 * the worker process exits.
 */
function runWorker_p(appSpec, socketPath, logFilePath) {
  return launchWorker_p(appSpec, socketPath, logFilePath).invoke('getExit_p');
};
exports.runWorker_p = runWorker_p;

/**
 * An AppWorker models a single R process that is running a Shiny app.
 *
 * @constructor
 * @param {AppSpec} appSpec - Contains the basic details about the app to
 *   launch
 * @param {String} socketPath - The domain socket path the app should listen on
 * @param {Stream} logStream - The stream to dump stderr to.
 */
var AppWorker = function(appSpec, socketPath, logStream, workerId) {
  this.$dfEnded = Q.defer();
  var self = this;

  this.exited = false;

  // Spawn worker process via su, to ensure proper setgid, initgroups, setuid,
  // etc. are called correctly.
  //
  // We use stdin to tell SockJSAdapter what app dir, port, etc. to use, so
  // that non-root users on the system can't use ps to discover what apps are
  // available and on what ports.

  logger.trace("Starting R");

  try {
    // Run R
    var args = [
      '--',
      appSpec.runAs,
      '-c',
      bash.escape(rprog) + " --no-save --slave -f " + bash.escape(scriptPath)
    ];

    if (process.platform === 'linux') {
      // -s option not supported by OS X (or FreeBSD, or Sun)
      args = ['-s', '/bin/sh'].concat(args);
    } else {
      // Other platforms don't clear out env vars, so simulate user env
      args.unshift('-');
    }

    this.$proc = child_process.spawn('su', args, {
      stdio: ['pipe', 'ignore', logStream],
      detached: true  // So that we can send SIGINT not just to su but to the
                      // R process that it spawns as well
    });
    this.$proc.on('exit', function(code, signal) {
      self.exited = true;
      self.$dfEnded.resolve({code: code, signal: signal});
    });
    this.$proc.stdin.end(
      appSpec.appDir + '\n' +
      socketPath + '\n' +
      (appSpec.settings.gaTrackingId || '') + '\n' +
      SHINY_SERVER_VERSION + '\n' + 
      workerId + '\n'
    );
  } catch (e) {
    logger.trace(e);
    this.$dfEnded.reject(e);
  }
};

(function() {

  /**
   * Returns a promise that is resolved when the process exits.
   * If the process terminated normally, code is the final exit
   * code of the process, otherwise null. If the process
   * terminated due to receipt of a signal, signal is the string
   * name of the signal, otherwise null.
   */
  this.getExit_p = function() {
    return this.$dfEnded.promise;
  };

  this.isRunning = function() {
    return !this.exited;
  };

  /**
   * Attempts to kill the process using the signal provided. If
   * it detects a Mac environment, it will use the pkill command to
   * send a SIGABRT signal to this process and its descendents.
   * Otherwise, it will send a SIGINT signal to the entire process
   * group.
   * @param {String} [signal] - The signal to send (defaults to 'SIGABRT'
   * if on a Mac, or 'SIGINT' otherwise).
   */
  this.kill = function(signal) {
    if (process.platform == "darwin"){
      signal = signal || 'SIGABRT';
      logger.trace('Sending ' + signal + ' to ' + (this.$proc.pid));
      child_process.spawn('pkill', ['-' + bash.escape(signal), '-P', bash.escape(this.$proc.pid)]); 
    } else {
      signal = signal || 'SIGINT';
      logger.trace('Sending ' + signal + ' to ' + (-this.$proc.pid));
      process.kill(-this.$proc.pid, signal); 
    }
  };

}).call(AppWorker.prototype);
