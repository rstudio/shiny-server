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
  
}
SchedulerRegistry.__set__("SimpleScheduler", SimpleScheduler);
var mockSimpleScheduler = sinon.mock(SimpleScheduler.prototype);


// Stub an appSpec
var appSpec = {
  getKey: function(){},
  settings: {appDefaults: {sessionTimeout: 10}}
};
sinon.stub(appSpec, "getKey", function(){return "appSpecKey"})

//  Init an eventBus on which we can spy.
var eventBus =  new SimpleEventBus();

// Define some static params which will be passed in.
var URL = "/URL";
var WORKER = "SomeWorker";


describe('SchedulerRegistry', function(){
  
  // Init the spies
  before(function(){
    sinon.spy(eventBus, "on");
    sinon.spy(eventBus, "emit");
  });

  describe('#getWorker_p', function(){
    it('Creates a new scheduler on initial request.', function(){
      // Define the expectations on the mock
      mockSimpleScheduler.expects("acquireWorker_p")
        .once()
        .withExactArgs(appSpec, URL, WORKER);


      var schedReg = new SchedulerRegistry(eventBus);

      _.size(schedReg.$schedulers).should.equal(0);
      schedReg.getWorker_p(appSpec, URL, WORKER);
      
      // Confirm we created the scheduler in the right place and of the right type.
      _.keys(schedReg.$schedulers).should.includeEql(appSpec.getKey());
      schedReg.$schedulers[appSpec.getKey()].should.include({type: "MockSimpleScheduler"});

      // Verify the expectations on the mock, then restore.
      mockSimpleScheduler.verify();
      mockSimpleScheduler.restore();
    }),
    it('Doesn\'t create a new scheduler for a repeat request.'),
    it('Creates a new scheduler for a new AppSpec'),
    it('Properly considers local app config when creating a new scheduler.')
  });

  // Tear down the spies
  after(function(){
    eventBus.on.restore();
    eventBus.emit.restore();
  });

})
