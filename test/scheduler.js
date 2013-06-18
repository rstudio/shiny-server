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

var Scheduler = require('../lib/scheduler/scheduler.js');
var AppSpec = require('../lib/worker/app-spec.js');
var sinon = require('sinon');
var Q = require('q');
var _ = require('underscore');

var scheduler = new Scheduler();
var appSpec = new AppSpec("/var/shiny-www/testA/", "jalle6", "", "/tmp", {})


SHINY_SERVER_VERSION = "0.3.5";

describe('Scheduler', function(){
  describe('#spawnWorker_p', function(){
    it('properly stores provided data.', function(done){
      //check that we're starting off with no workers.
      Object.keys(scheduler.$workers).should.be.empty;

      //request a worker
      scheduler.spawnWorker_p(appSpec, {a:5, b:"test"})
      .then(function(wh){ wh.kill('SIGABRT'); })
      .then(done, done).done();

      //check that exactly one app had workers created
      Object.keys(scheduler.$workers).should.have.length(1);

      //check that exactly one worker has been created for this app's key.
      var relWorkers = scheduler.$workers[appSpec.getKey()];
      Object.keys(relWorkers).should.have.length(1);

      //check that the worker has the necessary fields created.
      var worker = relWorkers[Object.keys(relWorkers)[0]];
      worker.should.have.keys(['data', 'promise']);
      worker.data.should.have.keys(['a', 'b', 'sockConn', 'httpConn']);
    }),
    it('properly handles acquire and release.', function(done){
      //check that we're starting off with the last.
      Object.keys(scheduler.$workers).should.have.length(1);

      //slightly modify the settings to get a new app
      appSpec.settings = {x:1};

      var workerPromise = scheduler.spawnWorker_p(appSpec);

      //check that exactly one worker has been created for this app's key.
      var relWorkers = scheduler.$workers[appSpec.getKey()];
      Object.keys(relWorkers).should.have.length(1);

      //get the created worker
      var worker = relWorkers[Object.keys(relWorkers)[0]];
      worker.data.httpConn.should.equal(0);
      worker.data.sockConn.should.equal(0);

      // Acquire and release functions should have been inserted into the handle before
      // it was returned. Check.
      workerPromise.then(function(wh){
        worker.data.httpConn.should.equal(0);
        wh.acquire('http');
        worker.data.httpConn.should.equal(1);

        worker.data.sockConn.should.equal(0);
        wh.acquire('sock');
        worker.data.sockConn.should.equal(1);

        wh.release('sock');
        worker.data.sockConn.should.equal(0);

        worker.data.httpConn.should.equal(1);
        wh.release('http');
        worker.data.httpConn.should.equal(0);

        wh.kill();
      })
      .then(done, done).done();
      // note that the `.then(done, done)` is imperative if you actually want to wait
      // until the R process starts. Without this, all the background async stuff will 
      // just drag on after the (synchronous) test assertions have long been completed.
    }),
    it('sets timer after last connection.', function(done){
        this.timeout(10000);

        //check that we're starting off with the last two apps.
        Object.keys(scheduler.$workers).should.have.length(2);

        //slightly modify the settings to get a new app
        appSpec.settings = {x:2};

        var workerPromise = scheduler.spawnWorker_p(appSpec);

        //check that exactly one worker has been created for this app's key.
        var relWorkers = scheduler.$workers[appSpec.getKey()];
        Object.keys(relWorkers).should.have.length(1);

        //get the created worker
        var worker = relWorkers[Object.keys(relWorkers)[0]];
        worker.data.httpConn.should.equal(0);
        worker.data.sockConn.should.equal(0);

        // Acquire and release functions should have been inserted into the handle before
        // it was returned. Check.
        workerPromise.then(function(wh){
          wh.acquire('http');
          wh.acquire('http');
          wh.acquire('sock');
          wh.release('sock');
          wh.release('http');
          //ensure that no timer has been activated yet.
          Object.keys(worker.data).should.have.length(2); // just conn counts.

          wh.release('http');
          //ensure timer is now active
          Object.keys(worker.data).should.have.length(3); // added timer
          worker.data.timer.should.exist;

          //create a promise that can be used to reference the outcome of this check.
          var defer = Q.defer();

          // create a timer that will check periodically to see if the worker has been
          // killed. If it isn't destroyed by the time it should have been, then this
          // test fails.
          var timeout = 7000;
          var elapsed = 0;
          var interval = 1000;
          var intervalId = setInterval(function() {
            elapsed += interval;
            if (elapsed > timeout) {
              defer.reject(new Error('The application didn\'t close in time.'));
              wh.kill();
              clearInterval(intervalId);
              return;
            }

            logger.trace('Checking to see if worker has closed...');
            if (_.size(scheduler.$workers[appSpec.getKey()]) == 0){
              logger.trace('Worker is closed.');
              clearInterval(intervalId);
              defer.resolve();
              return;
            }
          }, interval);

          return defer.promise;
        })
        .then(done,done).done();
        // note that the `.then(done, done)` is imperative if you actually want to wait
        // until the R process starts. Without this, all the background async stuff will 
        // just drag on after the (synchronous) test assertions have long been completed.
      })
  })
})
