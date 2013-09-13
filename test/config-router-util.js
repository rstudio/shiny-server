/*
 * test/config-router-util.js
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

var configRouterUtil = require('../lib/router/config-router-util');
var sinon = require('sinon');
var config = require('../lib/config/config'); 
var ConfigNode = config.ConfigNode;
var _ = require('underscore');

var should = require('should'); // need the static functions.

var APP_PATH = {appDir: "/somePath"};
var SIMPLE_PARAMS = {maxRequests: 10};
var APP_INIT_PARAMS = {timeout: 5};
var APP_IDLE_PARAMS = {timeout: 8};
var LOCATION_PARAMS = {path: '/'};

/** 
 * Helper function to init a sample config for testing.
 * 
 * @param scheduler Where to include a scheduler. If falsy, won't be
 *   generated anywhere. If 'self', will be added to the app node. If
 *   'parent', will be added to the parent node.
 * @param idle Where to include the `app_idle_timeout` parameter. Same
 *    options as are available for 'scheduler' param.
 * @param init Where to include the `app_init_timeout` parameter. Same
 *    options as are available for 'scheduler' param.
 */
function initConfig(scheduler, idle, init){

  // Helper function that returns the appropriate node given the string parameter
  function chooseNode(parentNode, thisNode, selection){
    if (selection === "self"){
      return thisNode;
    } else if (selection === "parent"){
      return parentNode;
    } else{
      throw new Error("Invalid selection: " + selection);
    }
  }

  var parentNode = new ConfigNode(null, 'location', _.values(LOCATION_PARAMS), null);
  parentNode.values = LOCATION_PARAMS;

  var appNode = new ConfigNode(parentNode, 'application', _.values(APP_PATH), null);
  appNode.values = APP_PATH;
  // Since we're not doing the schole schema validation, we'll just 
  // short-cirtuit and specify the values directly.

  if (scheduler){
    var simpleNode = new ConfigNode( chooseNode(parentNode, appNode, scheduler),
        'simple_scheduler', _.values(SIMPLE_PARAMS), null);
    simpleNode.values = SIMPLE_PARAMS;
    chooseNode(parentNode, appNode, scheduler).children.push(simpleNode);
  }

  if(idle){
    var idleNode = new ConfigNode( chooseNode(parentNode, appNode, idle)
      , 'app_idle_timeout', _.values(APP_IDLE_PARAMS), null);
    idleNode.values = APP_IDLE_PARAMS;
    chooseNode(parentNode, appNode, idle).children.push(idleNode); 
  }

  if(init){
    var initNode = new ConfigNode( chooseNode(parentNode, appNode, init), 
        'app_init_timeout', _.values(APP_INIT_PARAMS), null);
    initNode.values = APP_INIT_PARAMS;
    chooseNode(parentNode, appNode, init).children.push(initNode);
  }

  return appNode;
}


describe('ConfigRouterUtil', function(){  
  describe('#parseApplication', function(){
    it('extracts params from local node w/ defaults', function(){
      var appNode = initConfig("self", "self", "self");

      var settings = configRouterUtil.parseApplication({}, appNode, true);

      settings.scheduler.should.eql({simple: {maxRequests: 10}});
      settings.appDefaults.initTimeout.should.equal(5);
      settings.appDefaults.idleTimeout.should.equal(8);      
    }),
    it('extracts params from parent node w/ defaults', function(){
      var appNode = initConfig("parent", "parent", "parent");

      var settings = configRouterUtil.parseApplication({}, appNode, true);

      settings.scheduler.should.eql({simple: {maxRequests: 10}});
      settings.appDefaults.initTimeout.should.equal(5);
      settings.appDefaults.idleTimeout.should.equal(8);
    }),
    it('extracts params from local node w/o defaults', function(){
      var appNode = initConfig("self", "self", "self");

      var settings = configRouterUtil.parseApplication({}, appNode, false);

      settings.scheduler.should.eql({simple: {maxRequests: 10}});
      settings.appDefaults.initTimeout.should.equal(5);
      settings.appDefaults.idleTimeout.should.equal(8);
    }),
    it('extracts params from parent node w/o defaults', function(){
      var appNode = initConfig("parent", "parent", "parent");

      var settings = configRouterUtil.parseApplication({}, appNode, false);

      settings.scheduler.should.eql({simple: {maxRequests: 10}});
      settings.appDefaults.initTimeout.should.equal(5);
      settings.appDefaults.idleTimeout.should.equal(8);
    }),
    it('provide idleTimeout if missing w/ provideDefaults', function(){
      var appNode = initConfig("parent", null, "parent");

      var settings = configRouterUtil.parseApplication({}, appNode, true);

      settings.scheduler.should.eql({simple: {maxRequests: 10}});
      settings.appDefaults.initTimeout.should.equal(5);
      settings.appDefaults.idleTimeout.should.equal(5);
    }),
    it('provide all if missing w/ provideDefaults', function(){
      var appNode = initConfig(null, null, null);

      var settings = configRouterUtil.parseApplication({}, appNode, true);

      settings.scheduler.should.eql({simple: {maxRequests: 100}});
      settings.appDefaults.initTimeout.should.equal(60);
      settings.appDefaults.idleTimeout.should.equal(5);
    }),
    it('provide only scheduler if all missing w/o provideDefaults', function(){
      var appNode = initConfig(null, null, null);

      var settings = configRouterUtil.parseApplication({}, appNode, false);

      settings.scheduler.should.eql({simple: {maxRequests: 100}});
      should.not.exist(settings.appDefaults.idleTimeout);
      should.not.exist(settings.appDefaults.initTimeout);
    }),
    it('won\'t provide idleTimeout if missing w/o provideDefaults', function(){
      var appNode = initConfig("parent", null, "parent");

      var settings = configRouterUtil.parseApplication({}, appNode, false);

      settings.scheduler.should.eql({simple: {maxRequests: 10}});
      settings.appDefaults.initTimeout.should.equal(5);
      should.not.exist(settings.appDefaults.idleTimeout);
    })
  })
});
