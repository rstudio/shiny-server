/*
 * scheduler-registry.js
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
var OutOfCapacityError = require('../core/errors').OutOfCapacity;
var map = require('../core/map');
var fsutil = require('../core/fsutil');
var AppWorkerHandle = require('../worker/app-worker-handle');
var app_worker = require('../worker/app-worker');
var SimpleScheduler = require('./simple-scheduler');
var events = require('events');

var SchedulerRegistry = function(eventBus) {
  events.EventEmitter.call(this);

  this.$eventBus = eventBus;
  this.$schedulers = map.create();

  var self = this;
  this.$eventBus.on('vacantSched', function(appKey){
    // Delete this scheduler from the registry, if it exists.
    delete self.$schedulers[appKey];
  });
};
SchedulerRegistry.prototype.__proto__ = events.EventEmitter.prototype;
module.exports = SchedulerRegistry;

(function() {

  this.setTransport = function(transport) {
    this.$transport = transport;
    //tell all the schedulers what transport to use
    _.each(this.$schedulers, function(sched) {
      sched.setTransport(transport);
    });
  };

  /**
   * Asynchronously retrieves an already-existant worker or attempts to create
   * a new one, and returns a promise for the AppWorkerHandle.
   *
   * @param {AppSpec} appSpec - Contains the basic details about the app to
   *   launch
   * @param {String} worker - The ID of the worker which this request is
   *   targetting. If left blank, an arbitrary worker will be selected. Ignored
   *   when using the SimpleScheduler.
   */
  this.getWorker_p = function(appSpec, url, worker) {
    var key = appSpec.getKey();
    if (!this.$schedulers[key]){
      //no scheduler, instantiate a simple scheduler
      this.$schedulers[key] = new SimpleScheduler(this.$eventBus, appSpec, 
        appSpec.settings.appDefaults.sessionTimeout);
      if (this.$transport){
        this.$schedulers[key].setTransport(this.$transport);
      }
    }  
    
    return this.$schedulers[key].acquireWorker_p(appSpec, url, worker); 
  };

  this.shutdown = function() {
    _.each(this.$schedulers, function(sched) {
      sched.shutdown();
    });
  };

  this.dump = function(){
    _.each(this.$schedulers, function(sched) {
      sched.dump();
    });
  };
}).call(SchedulerRegistry.prototype);
