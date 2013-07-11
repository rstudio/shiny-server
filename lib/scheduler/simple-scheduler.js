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

var SimpleScheduler = function() {
	//run base Scheduler's constructor.
	Scheduler.call(this);
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

	      // The threshold at which new users (incoming requests for "/") will
	      // get 503 errors. As a percentage of maxRequests.
	      var threshold = 0.8;

	      if (appSpec.settings.scheduler.simple && 
	      	appSpec.settings.scheduler.simple.maxRequests){
	      	var hardLimit = appSpec.settings.scheduler.simple.maxRequests;
	      	var softLimit = Math.round(hardLimit * threshold);

	      	// In low-max-connection environments, 0.8 * hardLimit doesn't 
	      	// make sense, as we really want to guarantee that we have enough
	      	// room to load a basic Shiny App's dependent CSS and JS files
	      	// (typically resulting in about 5 concurrent connections.). So
	      	// we want to ensure, as best we can, that we're leaving 5-10
	      	// connection slots open before we accept a new session. So take
	      	// the minimum of (0.8 * hardLimit, hardLimit - 10) unless hardLimit
	      	// is below 10, in which case we'll just set it to 2, so that we'll
	      	// start 503'ing new sessions after 2 WS connections.
	      	softLimit = Math.min(softLimit, Math.max(hardLimit-10, 2));

	      	var thisWorker = this.$workers[_.keys(this.$workers)[0]];
	      	var conns = thisWorker.data.sockConn + 
	      							thisWorker.data.httpConn +
	      							thisWorker.data.pendingConn;

	      	if (url != '/' && conns < hardLimit){
	      		// If it looks like a request from an existing session (i.e. it's not 
	      		// requesting the base URL), then permit it up to hard limit.
	      		return Q.resolve(this.$workers[Object.keys(this.$workers)[0]].promise);
	      	}
	      	else if (url == '/' && conns < softLimit){
	      		// Looks like a request for a new session and we're below our 
	      		// softLimit.
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
