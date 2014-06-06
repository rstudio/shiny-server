/*
 * nested-locations.js
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

var assert = require('assert');
var path = require('path');
var util = require('util');
var rewire = require("rewire");
var Q = require('q');
var paths = require('../lib/core/paths');

var config_router = rewire('../lib/router/config-router');

// Don't check if permissions are valid, as this would require us to
// run the tests as root
config_router.__set__("checkPermissions", function() {});

function testBadConfig(desc, configFile, errorPattern) {
  it(desc, function(done) {
    config_router.createRouter_p(configFile, null)
    .then(
      function(router) {
        done(new Error('expected an error'));
      },
      function(err) {
        if (errorPattern.test(err.message)) {
          done();
        } else {
          done(err);
        }
      }
    )
  });
}

describe('Nested locations', function() {
  it('can parse valid configs', function(done) {
    var configFile = paths.projectFile('test/configs/valid.config');
    config_router.createRouter_p(configFile, null)
    .then(function(router) {
      var locs = router.servers[0].$locations;
      var locB = locs[0];
      var locC = locs[1];
      var locD = locs[2];
      var locA = locs[3];
      locB.$prefix.should.equal('/a/b/');
      locB.$settings.appDefaults.idleTimeout.should.equal(5);
      locC.$prefix.should.equal('/a/c/');
      locC.$settings.appDefaults.idleTimeout.should.equal(30);
      locD.$router.$dirIndex.should.equal(false);
      locD.$router.$root.should.equal('/srv/shiny-server');
      locA.$dirIndex.should.equal(true);
      locA.$root.should.equal('/srv/shiny-server');
    })
    .then(done, done)
    .done();
  });

  testBadConfig(
    'detects invalid nesting',
    paths.projectFile('test/configs/bad1.config'),
    /may not inherit the app_dir directive/
  );
  
  testBadConfig(
    'detects no hosting model',
    paths.projectFile('test/configs/bad2.config'),
    /must contain \(or inherit\)/
  );
  
});
