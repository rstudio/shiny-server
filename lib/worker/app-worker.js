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
 * @param {Number} listenPort - The port number that the Shiny app should use.
 * @param {String} logFilePath - The file path to write stderr to.
 */
function launchWorker_p(appSpec, listenPort, logFilePath) {
  
  if (!appSpec.runAs)
    return Q.reject(new Error("No user specified"));

  var pw = posix.getpwnam(appSpec.runAs);
  if (!pw)
    return Q.reject(new Error("User " + username + " does not exist"));

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
      var worker = new AppWorker(appSpec, listenPort, logStream);
      worker.getExit_p().fin(function() {
        logStream.end();
      });

      return worker;
    });
  });
};
exports.launchWorker_p = launchWorker_p;

/**
 * Like launchWorker_p, but the promise it returns doesn't resolve until
 * the worker process exits.
 */
function runWorker_p(appSpec, listenPort, logFilePath) {
  return launchWorker_p(appSpec, listenPort, logFilePath).invoke('getExit_p');
};
exports.runWorker_p = runWorker_p;

/**
 * An AppWorker models a single R process that is running a Shiny app.
 *
 * @constructor
 * @param {AppSpec} appSpec - Contains the basic details about the app to
 *   launch
 * @param {Number} listenPort - The port number that the Shiny app should use.
 * @param {Stream} logStream - The stream to dump stderr to.
 */
var AppWorker = function(appSpec, listenPort, logStream) {
  this.$dfEnded = Q.defer();
  var self = this;

  this.exited = false;

  // Spawn worker process via su, to ensure proper setgid, initgroups, setuid,
  // etc. are called correctly.
  //
  // We use stdin to tell SockJSAdapter what app dir, port, etc. to use, so
  // that non-root users on the system can't use ps to discover what apps are
  // available and on what ports.

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
      listenPort + '\n' +
      (appSpec.settings.gaTrackingId || '') + '\n' +
      SHINY_SERVER_VERSION + '\n'
    );
  } catch (e) {
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
   * Sends the signal to the process group of the app worker.
   * @param {String} [signal] - The signal to send (defaults to 'SIGINT').
   */
  this.kill = function(signal) {
    signal = signal || 'SIGINT';
    logger.trace('Sending ' + signal + ' to ' + (-this.$proc.pid));
    process.kill(-this.$proc.pid, signal);
  };

}).call(AppWorker.prototype);
