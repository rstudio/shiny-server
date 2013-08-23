/*
 * app-worker-handle.js
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
var events = require('events');
var util = require('util');

var AppWorkerHandle = function(appSpec, endpoint, logFilePath,
    exitPromise, kill) {

  events.EventEmitter.call(this);
  this.appSpec = appSpec;
  this.endpoint = endpoint;
  this.logFilePath = logFilePath;
  this.exitPromise = exitPromise;
  this.kill = kill;
};
module.exports = AppWorkerHandle;

util.inherits(AppWorkerHandle, events.EventEmitter);

(function() {
  /**
   * Kill the worker using the given signal (defaults to 'SIGABRT' on OSX, 
   * 'SIGINT' on all other platforms). This is
   * actually overridden in the constructor, this stub is just here for
   * documentation purposes.
   */
  this.kill = function(signal) {
  };

}).call(AppWorkerHandle.prototype);
