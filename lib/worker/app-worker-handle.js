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

var AppWorkerHandle = function(appSpec, sockName, socketPath, logFilePath,
    exitPromise, kill) {

  events.EventEmitter.call(this);
  this.appSpec = appSpec;
  this.sockName = sockName;
  this.socketPath = socketPath;
  this.logFilePath = logFilePath;
  this.exitPromise = exitPromise;
  this.kill = kill;

  this.$refCount = 0;
};
module.exports = AppWorkerHandle;

util.inherits(AppWorkerHandle, events.EventEmitter);

(function() {

  /**
   * Increment reference count.
   *
   * Call when a client is using this worker. This prevents the worker from
   * being reaped. Call release() when the client is done using the worker.
   */
  this.acquire = function() {
    this.$refCount++;
    logger.trace('Socket ' + this.sockName + ' acquired: ' + this.$refCount);
    this.emit('acquire', this.$refCount);
  };

  /**
   * Decrement reference count.
   *
   * Call when a client is done using this worker. This allows the worker to
   * potentially be reaped if the refcount is zero.
   */
  this.release = function() {
    this.$refCount--;
    logger.trace('Socket ' + this.sockName + ' released: ' + this.$refCount);
    this.emit('release', this.$refCount);
  };

  /**
   * Kill the worker using the given signal (defaults to 'SIGINT'). This is
   * actually overridden in the constructor, this stub is just here for
   * documentation purposes.
   */
  this.kill = function(signal) {
  };

}).call(AppWorkerHandle.prototype);