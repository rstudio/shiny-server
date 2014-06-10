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
var map = require('../core/map');
var paths = require('../core/paths');
var permissions = require('../core/permissions');
var posix = require('../../build/Release/posix');
var split = require('split');

var rprog = process.env.R || 'R';
var scriptPath = paths.projectFile('R/SockJSAdapter.R');

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
 * @param {Endpoint} endpoint - The endpoint that the Shiny app should
 *   listen on.
 * @param {String} logFilePath - The file path to write stderr to.
 */
function launchWorker_p(appSpec, endpoint, logFilePath, workerId) {
  if (!appSpec.runAs)
    return Q.reject(new Error("No user specified"));

  var pw = posix.getpwnam(appSpec.runAs);
  if (!pw)
    return Q.reject(new Error("User " + appSpec.runAs + " does not exist"));

  if (!pw.home)
    return Q.reject(new Error("User " + appSpec.runAs + 
      " does not have a home directory"));

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
      var worker = new AppWorker(appSpec, endpoint, logStream, workerId, 
        pw.home);
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
function runWorker_p(appSpec, endpoint, logFilePath) {
  return launchWorker_p(appSpec, endpoint, logFilePath).invoke('getExit_p');
};
exports.runWorker_p = runWorker_p;

/**
 * An AppWorker models a single R process that is running a Shiny app.
 *
 * @constructor
 * @param {AppSpec} appSpec - Contains the basic details about the app to
 *   launch
 * @param {String} endpoint - The transport endpoint the app should listen on
 * @param {Stream} logStream - The stream to dump stderr to.
 */
var AppWorker = function(appSpec, endpoint, logStream, workerId, home) {
  this.$dfEnded = Q.defer();
  var self = this;

  this.exited = false;
  this.$pid = null;

  // Spawn worker process via su, to ensure proper setgid, initgroups, setuid,
  // etc. are called correctly.
  //
  // We use stdin to tell SockJSAdapter what app dir, port, etc. to use, so
  // that non-root users on the system can't use ps to discover what apps are
  // available and on what ports.

  logger.trace("Starting R");

  try {
    // Run R
    var executable, args;
    var switchUser = appSpec.runAs !== null &&
        permissions.getProcessUser() !== appSpec.runAs;

    // Set mode to either 'shiny' or 'rmd'
    var mode = 'shiny';
    if (appSpec.settings && appSpec.settings.mode){
      mode = appSpec.settings.mode;
    }

    if (!switchUser && permissions.isSuperuser())
      throw new Error("Aborting attempt to launch R process as root");

    if (switchUser) {
      executable = 'su';
      args = [
        '-p',
        '--',
        appSpec.runAs,
        '-c',
        bash.escape(rprog) + " --no-save --slave -f " + bash.escape(scriptPath)
      ];
      
      if (process.platform === 'linux') {
        // -s option not supported by OS X (or FreeBSD, or Sun)
        args = ['-s', '/bin/bash', '--login'].concat(args);
      } else {
        // Other platforms don't clear out env vars, so simulate user env
        args.unshift('-');
      }
    } else {
      executable = rprog;
      args = ['--no-save', '--slave', '-f', scriptPath];
    }

    var self = this;

    Q.nfcall(fs.stat, appSpec.appDir)
    .then(function(stat){
      if (!stat.isDirectory()){
        throw new Error("Trying to launch an application that is not a directory: " + 
          appSpec.appDir);
      }
      self.$proc = child_process.spawn(executable, args, {
        stdio: ['pipe', 'pipe', logStream],
        cwd: appSpec.appDir,
        env: map.compact({
          'HOME' : home,
          'LANG' : process.env['LANG'],
          'PATH' : process.env['PATH']
        }),
        detached: true  // So that we can send SIGINT not just to su but to the
                        // R process that it spawns as well
      });
      self.$proc.on('exit', function(code, signal) {
        self.exited = true;
        self.$dfEnded.resolve({code: code, signal: signal});
      });
      self.$proc.stdin.on('error', function(){
        logger.warn("Unable to write to Shiny process. Attempting to kill it.");
        self.kill();
      });
      self.$proc.stdin.end(
        appSpec.appDir + '\n' +
        endpoint.getAppWorkerPort() + '\n' +
        (appSpec.settings.gaTrackingId || '') + '\n' +
        endpoint.getSharedSecret() + '\n' +
        SHINY_SERVER_VERSION + '\n' + 
        workerId + '\n' + 
        mode + '\n' + 
        paths.projectFile('ext/pandoc') + '\n'
      );
      self.$proc.stdout.pipe(split()).on('data', function(line){
        var match = null;
        if (line.match(/^Starting Shiny with process ID: '(\d+)'$/)){
          var pid = parseInt(
            line.match(/^Starting Shiny with process ID: '(\d+)'$/)[1]);
          self.$pid = pid;
          logger.trace("R process spawned with PID " + pid);
        } else if (match = line.match(/^Shiny version: (\d+)\.(\d+)\.(\d+)(\.(\d+))?$/)){
          logger.trace("Using shiny version: " + match[1] + "." + match[2] + 
              "." + match[3] + ((match[5])?"."+match[5]:""));
        } else if (match = line.match(/^R version: (\d+)\.(\d+)\.(\d+)$/)){
          logger.trace("Using R version: " + match[1] + "." + match[2] + 
              "." + match[3]);
        } else if (match = line.match(/^rmarkdown version: (\d+)\.(\d+)\.(\d+)(\.(\d+))?$/)){
          logger.trace("Using rmarkdown version: " + match[1] + "." + match[2] + 
              "." + match[3] + ((match[5])?"."+match[5]:""));
        }
      });
    })
    .fail(function(err){
      // An error occured spawning the process, could be we tried to launch a file
      // instead of a directory.
      logger.warn(err.message);
      
      self.$dfEnded.resolve({code: -1, signal: null});
    })
    .done();
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
   * Attempts to kill the process using the signal provided by
   * sending a SIGINT signal to the R process; if the process
   * is still alive after a few seconds, we send SIGTERM.
   */
  this.kill = function() {
    var exitPromise = this.getExit_p();
    if (!exitPromise.isPending())
      return;

    var pid = this.$pid;
    logger.trace('Sending SIGINT to ' + pid);
    process.kill(pid, 'SIGINT');

    var timerId = setTimeout(function() {
      logger.debug('Process ' + pid + ' did not exit on SIGINT; sending SIGTERM');
      process.kill(pid, 'SIGTERM');
    }, 20000); // TODO: Should this be configurable?

    exitPromise
    .then(function() {
      clearTimeout(timerId);
    })
    .eat();
  };

}).call(AppWorker.prototype);
