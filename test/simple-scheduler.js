/*
 * test/simple-scheduler.js
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

var SimpleScheduler = require('../lib/scheduler/simple-scheduler.js');
var AppSpec = require('../lib/worker/app-spec.js');
var sinon = require('sinon');
var Q = require('q');

var appSpec = new AppSpec("/var/shiny-www/01_hello/", "jeff", "", "/tmp", {})
var scheduler = new SimpleScheduler(appSpec);
scheduler.setSocketDir("/tmp/shiny-session/");

describe('SimpleScheduler', function(){
  describe('#acquireWorker_p()', function(){
    it('should initially create a new worker.', function(done){
      //check that we're starting off with no workers.
      Object.keys(scheduler.$workers).should.be.empty;

      //request a worker
      scheduler.acquireWorker_p(appSpec)
      .then(function(wh){
        //check that exactly one app had workers created
        Object.keys(scheduler.$workers).should.have.length(1);

        //check that exactly one worker has been created for this scheduler.
        var relWorkers = scheduler.$workers;
        Object.keys(relWorkers).should.have.length(1);

        //check that the worker has the necessary fields created.
        var worker = relWorkers[Object.keys(relWorkers)[0]];
        worker.should.have.keys(['data', 'promise']);
        Object.keys(worker.data).should.have.length(4);
        return wh;
      })
      .then(function(wh){ wh.kill(); return(wh.exitPromise); })
      .then(function(){})
      .then(done, done).done();
    }),
    it('should not create a new worker for requests to the same app.', function(done){
      //check that we're starting fresh.
      Object.keys(scheduler.$workers).should.have.length(0);

      //request a worker for the new app
      scheduler.acquireWorker_p(appSpec)
      .then(function(wh){
        //check that exactly one worker has been created for this scheduler.
        var relWorkers = scheduler.$workers;
        Object.keys(relWorkers).should.have.length(1);

        //check that the worker has the necessary fields created.
        var worker = relWorkers[Object.keys(relWorkers)[0]];
        worker.should.have.keys(['data', 'promise']);

        return wh;
      })
      .then(function(wh){ wh.kill(); return(wh.exitPromise); })
      .then(function(){})
      .then(done, done).done();

    }),
    it('should not surpass the MAX_REQUESTS directive.')
  })

})
