/*
 * test/squash-run-as-router.js
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

var SquashRunAsRouter = require('../lib/router/squash-run-as-router.js');
var Q = require('q');
var should = require('should');

/**
 * Construct a router that returns the given string as the runAs setting.
 **/
function constructRouter(runas){
  var router = new SquashRunAsRouter({getAppSpec_p : function(){ 
    return Q({runAs: runas});
  }});
  return router;
}

describe('SquashRunAsRouter', function(){
  describe('#getAppSpec_p', function(){
    it('returns the first string in a non-special array', function(done){
      constructRouter(['user1', 'user2', 'user3']).getAppSpec_p()
      .then(function(appSpec){
        appSpec.runAs.should.equal('user1');
      })
      .then(done, done);
    }),
    it('skips special users', function(done){
      constructRouter([':HOME_USER:', 'user2', 'user3']).getAppSpec_p()
      .then(function(appSpec){
        appSpec.runAs.should.equal('user2');
      })
      .then(done, done);
    }),
    it('returns undefined if no users', function(done){
      constructRouter([]).getAppSpec_p()
      .then(function(appSpec){
        should.not.exist(appSpec.runAs);
      })
      .then(done, done);
    }),
    it('returns undefined if only special users', function(done){
      constructRouter([':HOME_USER:', ':SOMETHING_ELSE:']).getAppSpec_p()
      .then(function(appSpec){
        should.not.exist(appSpec.runAs);
      })
      .then(done, done);
    }),
    it('skips non-strings', function(done){
      constructRouter([false, null, undefined, {a:1}, 14, 'user3']).getAppSpec_p()
      .then(function(appSpec){
        appSpec.runAs.should.equal('user3');
      })
      .then(done, done);
    })
  });
});

