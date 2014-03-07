/*
 * test/config-router.js
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

var sinon = require('sinon');
var should = require('should'); //need static function
var rewire = require("rewire");
var paths = require('../lib/core/paths');

var config_router = rewire('../lib/router/config-router');

// Don't check if permissions are valid, as this would require us to
// run the tests as root
config_router.__set__("checkPermissions", function() {});


global.logger.warn = sinon.spy();

describe('License', function(){  
  beforeEach(function(){
    logger.warn.reset();
  }),

  describe('#checkLocations', function(){
    describe('doesn\'t warn on a valid config', function(){
      it ('doesn\'t warn on validLoc1', function(){
        config_router.checkLocations(validLoc1);
        logger.warn.called.should.be.false;  
      }),
      it ('doesn\'t warn on validLoc2', function(){
        config_router.checkLocations(validLoc2);
        logger.warn.called.should.be.false;  
      }),
      it ('doesn\'t warn on validLoc3', function(){
        config_router.checkLocations(validLoc3);
        logger.warn.called.should.be.false;  
      })
    }),
    describe('does warn on an invalid config', function(){
      it ('does warn on invalidLoc1', function(){
        config_router.checkLocations(invalidLoc1);
        logger.warn.called.should.be.true;  
      }),
      it ('does warn on invalidLoc2', function(){
        config_router.checkLocations(invalidLoc2);
        logger.warn.called.should.be.true;  
      })
    })
  })
});

var invalidLoc1 = [ { '$root': '/srv/shiny-server/a',
    '$runas': 'shiny',
    '$dirIndex': true,
    '$logdir': '/var/log/shiny-server',
    '$settings': { appDefaults: [Object], scheduler: [Object] },
    prefix: '/a',
    '$rePath': /^\/a(?=\/|$)/ },
  { '$root': '/srv/shiny-server/01_hello',
    '$runas': 'shiny',
    '$dirIndex': false,
    '$logdir': '/var/log/shiny-server',
    '$settings': { appDefaults: [Object], scheduler: [Object] },
    prefix: '/a/b',
    '$rePath': /^\/a\/b(?=\/|$)/ } ];

var invalidLoc2 = [ { '$root': '/srv/shiny-server/a',
    '$runas': 'shiny',
    '$dirIndex': true,
    '$logdir': '/var/log/shiny-server',
    '$settings': { appDefaults: [Object], scheduler: [Object] },
    prefix: '',
    '$rePath': /^(?=\/|$)/ },
  { '$root': '/srv/shiny-server/01_hello',
    '$runas': 'shiny',
    '$dirIndex': false,
    '$logdir': '/var/log/shiny-server',
    '$settings': { appDefaults: [Object], scheduler: [Object] },
    prefix: '/a',
    '$rePath': /^\/a(?=\/|$)/ } ];


var validLoc1 = [ { '$root': '/srv/shiny-server/a',
    '$runas': 'shiny',
    '$dirIndex': true,
    '$logdir': '/var/log/shiny-server',
    '$settings': { appDefaults: [Object], scheduler: [Object] },
    prefix: '/a',
    '$rePath': /^\/a(?=\/|$)/ },
  { '$root': '/srv/shiny-server/b',
    '$runas': 'shiny',
    '$dirIndex': false,
    '$logdir': '/var/log/shiny-server',
    '$settings': { appDefaults: [Object], scheduler: [Object] },
    prefix: '/b',
    '$rePath': /^\/b(?=\/|$)/ } ];

var validLoc2 = [ { '$root': '/srv/shiny-server/b',
    '$runas': 'shiny',
    '$dirIndex': true,
    '$logdir': '/var/log/shiny-server',
    '$settings': { appDefaults: [Object], scheduler: [Object] },
    prefix: '/b',
    '$rePath': /^\/b(?=\/|$)/ },
  { '$root': '/srv/shiny-server',
    '$runas': 'shiny',
    '$dirIndex': true,
    '$logdir': '/var/log/shiny-server',
    '$settings': { appDefaults: [Object], scheduler: [Object] },
    prefix: '',
    '$rePath': /^(?=\/|$)/ } ];

var validLoc3 = [ { '$root': '/srv/shiny-server/a',
    '$runas': 'shiny',
    '$dirIndex': true,
    '$logdir': '/var/log/shiny-server',
    '$settings': { appDefaults: [Object], scheduler: [Object] },
    prefix: '/a/b',
    '$rePath': /^\/a\/b(?=\/|$)/ },
  { '$root': '/srv/shiny-server/01_hello',
    '$runas': 'shiny',
    '$dirIndex': false,
    '$logdir': '/var/log/shiny-server',
    '$settings': { appDefaults: [Object], scheduler: [Object] },
    prefix: '/home/01_hello',
    '$rePath': /^\/home\/01_hello(?=\/|$)/ } ];
