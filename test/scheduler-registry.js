/*
 * test/scheduler-registry.js
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

var Scheduler = require('../lib/scheduler/scheduler');
var SimpleScheduler = require('../lib/scheduler/simple-scheduler');
var SchedulerRegistry = require('../lib/scheduler/scheduler-registry');
var AppSpec = require('../lib/worker/app-spec');
var sinon = require('sinon');
var Q = require('q');
var _ = require('underscore');
var SimpleEventBus = require('../lib/events/simple-event-bus');

var appSpec = new AppSpec("/var/shiny-www/01_hello/", "jeff", "", "/tmp", 
    {scheduler: {}, appDefaults: {}});
var socketDir = "/tmp/shiny-session/";

describe('SchedulerRegistry', function(){
  describe('#getWorker_p', function(){
    it('Creates a new scheduler on initial request.', function(done){
      var schedReg = new SchedulerRegistry(new SimpleEventBus());
      schedReg.setSocketDir(socketDir);

      _.size(schedReg.$schedulers).should.equal(0);
      schedReg.getWorker_p(appSpec)
      .then(function(wh){
        _.keys(schedReg.$schedulers).should.includeEql(appSpec.getKey());
        (schedReg.$schedulers[appSpec.getKey()] instanceof SimpleScheduler).should.be.true;
        return (wh);
      })
      .then(function(wh){ wh.kill('SIGABRT'); return(wh.exitPromise); })
      .then(function() {})
      .then(done, done).done();
    }),
    it('Doesn\'t create a new scheduler for a repeat request.'),
    it('Creates a new scheduler for a new AppSpec'),
    it('Properly considers local app config when creating a new scheduler.')
  })
})
