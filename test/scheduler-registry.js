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

var _ = require('underscore');
var SimpleEventBus = require('../lib/events/simple-event-bus');
var rewire = require("rewire");
var sinon = require('sinon');

// Rewire the module in test so we can stub its modules.
var SchedulerRegistry = rewire('../lib/scheduler/scheduler-registry');

// Stub up a SimpleScheduler
var SimpleScheduler =  function (eventBus, appSpec, timeout) {
  this.type = "MockSimpleScheduler";
};
SimpleScheduler.prototype.acquireWorker_p = function(appSpec, url, worker){
  return {type: "MockWorker"};
}
SchedulerRegistry.__set__("SimpleScheduler", SimpleScheduler);

// Stub an appSpec
var appSpec = {
  getKey: function(){return "appSpecKey"},
  settings: {appDefaults: {sessionTimeout: 10}}
};

//  Init an eventBus on which we can spy.
var eventBus =  new SimpleEventBus();

// Define some static params which will be passed in.
var URL = "/URL";
var WORKER = "SomeWorker";

// Spy on the acquireWorker_p function.
var acquireWorkerSpy = sinon.spy(SimpleScheduler.prototype, "acquireWorker_p");


describe('SchedulerRegistry', function(){  
  afterEach(function(){
    acquireWorkerSpy.reset();
  })

  describe('#getWorker_p', function(){
    it('Creates a new scheduler on initial request.', function(){
      var schedReg = new SchedulerRegistry(eventBus);

      _.size(schedReg.$schedulers).should.equal(0);
      schedReg.getWorker_p(appSpec, URL, WORKER);
      
      // Confirm we created the scheduler in the right place and of the right type.
      _.size(schedReg.$schedulers).should.equal(1);
      _.keys(schedReg.$schedulers).should.eql([appSpec.getKey()]);
      schedReg.$schedulers[appSpec.getKey()].should.include({type: "MockSimpleScheduler"});

      acquireWorkerSpy.callCount.should.equal(1);
    }),
    it('Doesn\'t create a new scheduler for a repeat request.', function(){
      var schedReg = new SchedulerRegistry(eventBus);

      _.size(schedReg.$schedulers).should.equal(0);
      schedReg.getWorker_p(appSpec, URL, WORKER);
      schedReg.getWorker_p(appSpec, URL, WORKER);
      
      _.size(schedReg.$schedulers).should.equal(1);
      // Confirm we created the scheduler in the right place and of the right type.
      _.keys(schedReg.$schedulers).should.includeEql(appSpec.getKey());
      schedReg.$schedulers[appSpec.getKey()].should.include({type: "MockSimpleScheduler"});

      acquireWorkerSpy.callCount.should.equal(2);
    }),
    it('Deletes vacant schedulers.', function(){
      var schedReg = new SchedulerRegistry(eventBus);

      _.size(schedReg.$schedulers).should.equal(0);
      schedReg.getWorker_p(appSpec, URL, WORKER);
      _.size(schedReg.$schedulers).should.equal(1);

      eventBus.emit('vacantSched', appSpec.getKey());

      _.size(schedReg.$schedulers).should.equal(0);
    }),
    it('Creates a new scheduler for a new AppSpec & creates respective workers', function(){
      var schedReg = new SchedulerRegistry(eventBus);

      var alternateAppSpec =  {
        getKey: function(){return "alternateAppSpec"},
        settings: {appDefaults: {sessionTimeout: 10}}
      }; 

      _.size(schedReg.$schedulers).should.equal(0);
      schedReg.getWorker_p(appSpec, URL, WORKER);
      schedReg.getWorker_p(alternateAppSpec, URL, WORKER);
      
      _.size(schedReg.$schedulers).should.equal(2);
      // Confirm we created the scheduler in the right place and of the right type.
      _.keys(schedReg.$schedulers).should.includeEql(appSpec.getKey());
      schedReg.$schedulers[appSpec.getKey()].should.include({type: "MockSimpleScheduler"});

      acquireWorkerSpy.callCount.should.equal(2);
      acquireWorkerSpy.firstCall.calledWithExactly(appSpec, URL, WORKER).should.be.true;
      acquireWorkerSpy.secondCall.calledWithExactly(alternateAppSpec, URL, WORKER).should.be.true;
    })
  });
})
