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
var fs = require('fs');
var net = require('net');
var path = require('path');
var moment = require('moment');
var util = require('util');
var Q = require('q');
var _ = require('underscore');
require('../core/log');
var map = require('../core/map');
var AppWorkerHandle = require('./app-worker-handle');
var app_worker = require('./app-worker');

var WorkerRegistry = function(scheduler) {
  this.$workers = map.create();
  this.$scheduler = scheduler;
};
module.exports = WorkerRegistry;

(function() {

  /**
   * Asynchronously retrieves an already-existant worker or attempts to create
   * a new one, and returns a promise for the AppWorkerHandle.
   *
   * @param {AppSpec} appSpec - Contains the basic details about the app to
   *   launch
   * @param {String} worker - The ID of the worker which this request is
   *   targetting. If left blank, an arbitrary worker will be selected.
   */
  this.getWorker_p = function(appSpec, worker) {
    return this.$scheduler.acquireWorker_p(appSpec, worker);
  };

  this.shutdown = function() {
    this.$scheduler.shutdown();
  };

  this.dump = function(){
    this.$scheduler.dump();
  }

}).call(WorkerRegistry.prototype);