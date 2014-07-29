/*
 * metrics.js
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
 * This class is responsible for running the rserver-metrics process and
 * keeping it online.
 */
var child_process = require('child_process');
var path = require('path');
var Q = require('q');
var _ = require('underscore');
var paths = require('../core/paths');
var shutdown = require('../core/shutdown');
var split = require('split');
var loggerDir = paths.projectFile('ext/logger');
var loggerPath = path.join(loggerDir, "rstudio-logger");
var bash = require('bash');
var crypto = require('crypto');

// Progressively slow down our attempts to spawn a process by iterating
//  through these delays (in seconds).
var timeouts = [0, 1, 10, 60, 600];

function supplementExitPromise(self){
  self.$dfEnded.promise
  .fin(function(signal){
    if (!shutdown.shuttingDown){
      logger.warn("Logging process exited. Will restart in " + 
            timeouts[Math.min(self.$restartCount, _.size(timeouts)-1)] 
            + " seconds.");

      if (self.$runningTimer){
        clearTimeout(self.$runningTimer);
        self.$runningTimer = null;
      }

      //reset the promise, schedule a restart
      setTimeout(function(){
        self.init();
        self.$dfEnded = Q.defer();
        supplementExitPromise(self);  
      }, 1000 * timeouts[Math.min(self.$restartCount, _.size(timeouts)-1)]);
    }
    self.$restartCount++;
  })
}

/**
 * @param key - The shared key for the logging process.
 * @param port - The port on which the logging process should listen.
 * @param dir - The base directory for all log files.
 **/
var AppLogger = function(port, dir){
  var self = this;
  this.$dfEnded = Q.defer();
  _.bind(supplementExitPromise, self);
  supplementExitPromise(self);

  this.$interval = 60;
  this.$proc = null;
  this.$port = port;
  this.$dir = '/var/log/shiny-server/';

  this.$options = {
    Port: this.$port
  }
  
  // Count the number of failed startup attempts we've had.
  this.$restartCount = 0;

  // Set a timer which, after (2 * interval) seconds, will 
  // deem this as a "successful" startup and clear the counter
  // of failed attempts. If the program crashes before that interval
  // elapses, the timer should be reset.
  this.$runningTimer = null;

  this.init();
}
module.exports = AppLogger;

(function(){
  this.init = function(){
    logger.trace("Starting logging process.");

    try{
      var self = this;

      var exec, argArr;
      
      // The logging process will need the same privileges as the Shiny Server
      // process.
      exec = loggerPath;
      
      this.$proc = child_process.spawn(exec, [], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      shutdown.killOnShutdown(this.$proc, 'logger');
      self.$proc.stdin.write(
        JSON.stringify(self.$options) + '\n|||\n'
      );
      this.$proc.stderr.pipe(split()).on('data', function(line){
        logger.warn("logger proc: " + line);
      });
      this.$proc.stdout.pipe(split()).on('data', function(line){
        logger.trace("logger proc: " + line);
      });
      this.$proc.on('exit', function(code, signal) {
        logger.trace("Logger process exited with code: " + code + 
            " and signal : " + signal);
        self.$dfEnded.resolve({code: code, signal: signal});
      });
      
      // Deem this as a successful startup after (2 * interval) sec.
      this.$runningTimer = setTimeout(function(){
        self.$restartCount = 0;
        self.$runningTimer = null;
      }, 1000 * 2 * this.$interval);
    } catch (e) {
      logger.trace(e);
      this.$dfEnded.reject(e);
    }
  };

  /**
   * Generate a temporary token and inform the logging process about this 
   * token so that the token can be used to write to the given file path.
   **/
  this.getToken = function(path, uid, gid){
    if (!path){
      throw new Error("You must provide a path when creating a token.");
    }
    var loggingKey = crypto.randomBytes(16).toString('hex');
    var obj = {Token:loggingKey, File: path};

    if (uid){
      obj.User = uid;
    }

    if (gid){
      obj.Group = gid;
    }

    var msg = JSON.stringify(obj) + '\n';
    this.$proc.stdin.write(msg);
    return loggingKey;
  }

  /**
   * Prepare the header to send to the logging process to describe this
   * connection.
   **/
  this.formatHeader = function(token){
    return JSON.stringify({Token: token});
  }

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
}).call(AppLogger.prototype);