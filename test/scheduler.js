/*
 * test/scheduler.js
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

var AppSpec = require('../lib/worker/app-spec.js');
var sinon = require('sinon');
var Q = require('q');
var _ = require('underscore');
var SimpleEventBus = require('../lib/events/simple-event-bus');
var rewire = require("rewire");
var sinon = require('sinon');

// need the static functions
var should = require('should');

var Scheduler = rewire('../lib/scheduler/scheduler.js');

var exitPromise = Q.defer();

var killSpy = sinon.spy();
Scheduler.__set__("app_worker", {launchWorker_p: function(){
  return Q({
    kill: killSpy,
    getExit_p: function(){ return exitPromise.promise; },
    isRunning: function(){ return true }
  });
}});

var appSpec = new AppSpec("/var/shiny-www/01_hello/", "jeff", "", "/tmp", {})
var scheduler;

var clock = sinon.useFakeTimers();

describe('Scheduler', function(){
  beforeEach(function(){
    scheduler = new Scheduler(new SimpleEventBus(), appSpec.getKey());
    scheduler.setTransport({alloc_p: function(){
      return Q({
        getLogFileSuffix: function(){ return "" },
        ToString: function(){ return "" },
        toString: function(){ return "" },
        connect_p: function(){ return Q(true) }
      })
    }});

    killSpy.reset();
    exitPromise = Q.defer();
  });



  describe('#spawnWorker_p', function(){
    it('properly stores provided data.', function(done){
      //check that we're starting off with no workers.
      Object.keys(scheduler.$workers).should.be.empty;

      //request a worker
      scheduler.spawnWorker_p(appSpec, {a:5, b:"test"})
      .then(function(wh){
        //check that exactly one worker has been created
        Object.keys(scheduler.$workers).should.have.length(1);

        //check that the worker has the necessary fields created.
        var worker = scheduler.$workers[Object.keys(scheduler.$workers)[0]];
        worker.should.have.keys(['data', 'promise']);
        worker.data.should.have.keys(['a', 'b', 'sockConn', 'httpConn', 
          'pendingConn', 'timer']);        
      })      
      .then(done, done).done();
    }),
    it('properly handles acquire and release.', function(done){
      //request a worker
      scheduler.spawnWorker_p(appSpec, {})
      .then(function(wh){
        var worker = scheduler.$workers[Object.keys(scheduler.$workers)[0]];

        worker.data.httpConn.should.equal(0);
        worker.data.sockConn.should.equal(0);

        wh.acquire('http');
        
        worker.data.httpConn.should.equal(1);
        worker.data.sockConn.should.equal(0);

        wh.acquire('sock');
        
        worker.data.httpConn.should.equal(1);
        worker.data.sockConn.should.equal(1);

        wh.release('http');
        
        worker.data.httpConn.should.equal(0);
        worker.data.sockConn.should.equal(1);

        wh.release('sock');
        
        worker.data.httpConn.should.equal(0);
        worker.data.sockConn.should.equal(0);        
      })      
      .then(done, done).done();
    }),
    it('sets timer after last connection.', function(done){
      //request a worker
      scheduler.spawnWorker_p(appSpec, {})
      .then(function(wh){
        // TODO: clean up 
        // The old tests all have pending kill timers which the spy will
        // capture if we just run this test now. Advance the clock to get
        // those kills out of the way then reset the spy to get an accurate
        // count from JUST this test.
        clock.tick(5500);
        killSpy.reset();

        //check that the worker has the necessary fields created.
        var worker = scheduler.$workers[Object.keys(scheduler.$workers)[0]];
        
        // make a connection so there should be no timer.
        wh.acquire('sock');

        should.not.exist(worker.data.timer);

        // release the only connection which should trigger the timer
        wh.release('sock');

        should.exist(worker.data.timer);

        // Advance time far enough that the process
        // should have been killed
        clock.tick(5500);

        killSpy.callCount.should.equal(1);

        // Mark the process as killed
        exitPromise.resolve(true);
        return exitPromise.promise.then(function(){
          Object.keys(scheduler.$workers).should.have.length(0);
        })
      })      
      .then(done, done).done();
    })
  })

  after(function(){
    clock.restore();
  });
})
