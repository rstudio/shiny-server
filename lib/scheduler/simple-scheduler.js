/*
 * simple-scheduler.js
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
var Scheduler = require('./scheduler');
var OutOfCapacityError = require('../core/errors').OutOfCapacity;
var map = require('../core/map');
var util = require('util');
var _ = require('underscore');
var Q = require('q');

var SimpleScheduler = function(eventBus, appSpec) {
	//run base Scheduler's constructor.
	Scheduler.call(this, eventBus, appSpec);
}
module.exports = SimpleScheduler;

//inherit Scheduler's methods.
util.inherits(SimpleScheduler, Scheduler);

(function() {
	/**
	 * Defines how this schedule will identify and select an R process to 
	 * fulfill its requests.
	 */
	this.acquireWorker_p = function(appSpec, url){
	    if (this.$workers && _.size(this.$workers) > 0) {
	      logger.trace('Reusing existing instance');

	      if (appSpec.settings.scheduler.simple && 
	      	appSpec.settings.scheduler.simple.maxRequests){
	      	var hardLimit = appSpec.settings.scheduler.simple.maxRequests;
	      	if (hardLimit == 0){
	      		hardLimit = Infinity;
	      	} 

	      	var thisWorker = this.$workers[_.keys(this.$workers)[0]];
	      	var conns = thisWorker.data.sockConn + 
	      							thisWorker.data.pendingConn;

	      	if (conns < hardLimit){
	      		// We have room for at least 1 more request
	      		return Q.resolve(this.$workers[Object.keys(this.$workers)[0]].promise);
	      	}
	      	else if (url != 'ws' && url != '/'){
	      		// We're not trying to create a new session, fulfill all HTTP traffic.
	      		return Q.resolve(this.$workers[Object.keys(this.$workers)[0]].promise);
	      	}
	      	else {
	      		throw new OutOfCapacityError("This application cannot handle " + 
	      			"another connection.");
	      	}
	      } else{
	      	// No limit specified, just direct an unlimited amount of traffic here.
	      	return Q.resolve(this.$workers[Object.keys(this.$workers)[0]].promise);
	      }
	    }

	    logger.trace('Spawning new instance');
	    return this.spawnWorker_p(appSpec);
	};

}).call(SimpleScheduler.prototype);
