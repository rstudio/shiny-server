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
var split = require('split');
var posix = require('../../build/Release/posix');

var rprog = process.env.R || 'R';
var scriptPath = paths.projectFile('R/SockJSAdapter.R');

const STDERR_PASSTHROUGH = !!process.env["SHINY_LOG_STDERR"];

function exists_p(path) {
  var defer = Q.defer();
  fs.exists(path, function(exists) {
    defer.resolve(exists);
  });
  return defer.promise;
}

function spawnUserLog_p(pw, appSpec, endpoint, logFilePath, workerId) {
  var prom = Q.defer();

  let mode = appSpec.settings.appDefaults.logFileMode;

  // Create the log file (and directory if needed)
  var rm = child_process.spawn(paths.projectFile('scripts/create-log.sh'), [logFilePath, mode],
    {uid: pw.uid, gid: pw.gid});
  rm.on('close', function (code) {
    if (code != 0){
      var err = "Failed to create log file: " + logFilePath +", " + mode;
      logger.error(err);
      prom.reject(err);
      return;
    }

    // Have R do the logging
    var worker = new AppWorker(appSpec, endpoint, logFilePath, workerId, 
      pw.home);
    prom.resolve(worker);
  });

  return prom.promise;
}


/**
 * Begins launching the worker; returns a promise that resolves when
 * the worker is constructed (doesn't necessarily mean the process has
 * actually begun running though).
 *
 * @param {AppSpec} appSpec - Contains the basic details about the app to
 *   launch
 * @param pw - the user info, a result of `posix.getpwnam()`
 * @param {Endpoint} endpoint - The endpoint that the Shiny app should
 *   listen on.
 * @param {String} logFilePath - The file path to write stderr to.
 */
function launchWorker_p(appSpec, pw, endpoint, logFilePath, workerId) {
   if (!pw)
    return Q.reject(new Error("User " + appSpec.runAs + " does not exist"));

  if (!pw.home)
    return Q.reject(new Error("User " + appSpec.runAs + 
      " does not have a home directory"));

  if (!appSpec.appDir)
    return Q.reject(new Error("No app directory specified"));


  return exists_p(appSpec.appDir).then(function(exists) { // TODO: does this need to be as user?
    if (!exists) {
      var err = new Error("App dir " + appSpec.appDir + " does not exist");
      err.code = 'ENOTFOUND';
      throw err;
    }
   
    if (!appSpec.logAsUser){
      var logDir = path.dirname(logFilePath);
      // Ensure that the log directory exists.
      try {
        fs.mkdirSync(logDir, '755');
        fs.chownSync(logDir, pw.uid, pw.gid);
      } catch (ex) {
        try {
          var stat = fs.statSync(logDir);
          if (!stat.isDirectory()) {
            logger.error('Log directory existed, was a file: ' + logDir);
            logDir = null;
          }
        } catch (ex2) {
          logger.error('Log directory creation failed: ' + ex2.message);
          logDir = null;
        }
      }

      let mode = appSpec.settings.appDefaults.logFileMode;

      // Manage the log file as root
      // Open the log file asynchronously, then create the worker
      return Q.nfcall(fs.open, logFilePath, 'a', mode).then(function(logStream) {
        fs.fchown(logStream, pw.uid, pw.gid, function(err) {
          if (err)
            logger.error('Error attempting to change ownership of log file at ' + logFilePath + ': ' + err.message);
        });
        fs.fchmod(logStream, mode, function(err) {
          if (err)
            logger.error('Error attempting to change permissions on log file at ' + logFilePath + ': ' + err.message);
        });

        // We got a file descriptor and have chowned the file which is great, but
        // we actually want a writeStream for this file so we can handle async
        // writes more cleanly.
        var writeStream = fs.createWriteStream(null,
          {fd: logStream, flags: 'w', mode: mode })

        // If we have problems writing to writeStream, report it at most once.
        var warned = false;
        writeStream.on('error', function(err) {
          if (!warned) {
            warned = true;
            logger.warn('Error writing to log stream: ', err);
          }
        });

        // Create the worker; when it exits (or fails to start), close
        // the logStream.
        var worker = new AppWorker(appSpec, endpoint, writeStream, workerId, 
          pw.home);
          
        return worker;
      });
    } else {
      return spawnUserLog_p(pw, appSpec, endpoint, logFilePath, workerId);
    }
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
 * Creates the top-level (system) bookmark state directory, then the user's
 * bookmark state directory, and then the app's bookmark state directory.
 */
function createBookmarkStateDirectory_p(bookmarkStateDir, username) {
  if (bookmarkStateDir === null || bookmarkStateDir === "") {
    return Q();
  }

  // Capitalize first character
  function capFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function createDir_p(dir, mode, username, label) {
    if (label) {
      label = label + ' ';
    } else {
      label = '';
    }

    return Q.nfcall(fs.mkdir, dir, mode)
    .then(function() {
      logger.info(
        capFirst('created ' + label + 'bookmark state directory: ' + dir)
      );
    })
    .then(function() {
      // chown if username was supplied
      if (typeof(username) === 'string') {
        var pw = posix.getpwnam(username);
        return Q.nfcall(fs.chown, dir, pw.uid, pw.gid);
      }
    })
    .fail(function(err) {
      return Q.nfcall(fs.stat, dir)
      .then(function(stat) {
        if (!stat.isDirectory()) {
          logger.error(
            capFirst(label + 'bookmark state directory existed, was a file: ' + dir)
          );
          throw err;
        }
      })
      .fail(function(err2) {
        logger.error(
          capFirst(label + 'bookmark state directory creation failed: ' + dir)
        );
        throw err2;
      });
    });
  }

  var userBookmarkStateDir = path.join(bookmarkStateDir, username);

  return createDir_p(bookmarkStateDir, '711')
  .then(function() {
    return createDir_p(userBookmarkStateDir, '700', username, 'user');
  })
  .fail(function(err) {
    throw err;
  });
}


/**
 * An AppWorker models a single R process that is running a Shiny app.
 *
 * @constructor
 * @param {AppSpec} appSpec - Contains the basic details about the app to
 *   launch
 * @param {String} endpoint - The transport endpoint the app should listen on
 * @param {Stream} logStream - The stream to dump stderr to, or the path to 
 *   the file where the logging should happen. If just the path, pass it in
 *   to the R proc to have R handle the logging itself.
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
        'cd ' + bash.escape(appSpec.appDir) + ' && ' + bash.escape(rprog) + " --no-save --slave -f " + bash.escape(scriptPath)
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

    // The file where R should send stderr, or empty if it should leave it alone.
    var logFile = '';
    if (_.isString(logStream)){
      logFile = logStream;
      logStream = 'ignore'; // Tell the child process to drop stderr
      logger.trace('Asking R to send stderr to ' + logFile);
    }

    var self = this;

    Q.nfcall(fs.stat, appSpec.appDir)
    .then(function(stat){
      if (!stat.isDirectory()){
        throw new Error("Trying to launch an application that is not a directory: " + 
          appSpec.appDir);
      }

      return createBookmarkStateDirectory_p(
        appSpec.settings.appDefaults.bookmarkStateDir,
        appSpec.runAs
      );
    })
    .then(function() {
      self.$proc = child_process.spawn(executable, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
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
        paths.projectFile('ext/pandoc') + '\n' +
        logFile + '\n' +
        appSpec.settings.appDefaults.disableProtocols.join(",") + '\n' +
        appSpec.settings.appDefaults.reconnect + '\n' +
        appSpec.settings.appDefaults.sanitizeErrors + '\n' +
        appSpec.settings.appDefaults.bookmarkStateDir + '\n'
      );
      var stdoutSplit = self.$proc.stdout.pipe(split());
      stdoutSplit.on('data', function stdoutSplitListener(line){
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
        } else if (match = line.match(/^==END==$/)){
          stdoutSplit.off('data', stdoutSplitListener);
          logger.trace("Closing backchannel");
        }
      });
      self.$proc.stderr
        .on('error', function(e) {
          logger.error('Error on proc stderr: ' + e);
        })
        .pipe(split())
          .on('data', function(line){
            if (STDERR_PASSTHROUGH) {
              logger.info(`[${appSpec.appDir}:${self.$pid}] ${line}`);
            }
            // Ensure that we, not R, are supposed to be handling logging.
            if (logStream !== 'ignore'){
              logStream.write(line+'\n');
            }
          })
          .on('end', function() {
            if (logStream !== 'ignore') {
              logStream.end();
            }
          });
    })
    .fail(function(err){
      // An error occured spawning the process, could be we tried to launch a file
      // instead of a directory.
      logger.warn(err.message);
      
      if (!self.$proc) {
        // We never got around to starting the process, so the normal code path
        // that closes logStream won't run.
        if (logStream !== 'ignore') {
          logStream.end();
        }
      }

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

    try {
      process.kill(pid, 'SIGINT');
      
      var timerId = setTimeout(function() {
        logger.debug('Process ' + pid + ' did not exit on SIGINT; sending SIGTERM');
        try {
          process.kill(pid, 'SIGTERM');
        } catch (e) {
          logger.trace("Failure sending SIGTERM: " + e);
        }
      }, 20000); // TODO: Should this be configurable?

      exitPromise
      .then(function() {
        clearTimeout(timerId);
      })
      .eat();
    } catch (e) {
      logger.trace("Failure sending SIGINT: " + e);
    }
  };
}).call(AppWorker.prototype);
