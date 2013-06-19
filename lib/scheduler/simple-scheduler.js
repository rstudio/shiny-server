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
	this.acquireWorker_p = function(appSpec){
	    if (this.$workers && _.size(this.$workers) > 0) {
	      logger.trace('Reusing existing instance');
	      return Q.resolve(this.$workers[Object.keys(this.$workers)[0]].promise);
	    }

	    logger.trace('Spawning new instance');
	    return this.spawnWorker_p(appSpec);
	};

}).call(SimpleScheduler.prototype);
