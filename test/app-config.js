/*
 * test/app-config.js
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
var AppConfig = require('../lib/config/app-config');

describe('AppConfig', function(){
  describe('#addLocalConfig', function(){
    it('properly supplements data.', function(){
      var appConfig = new AppConfig();
      var merged = appConfig.addLocalConfig({
            appDir: '/dir',
            runAs: 'user',
            settings: {
              scheduler: {
                simple: {}
              }
            }
          },
          {
            appDefaults: {
              initTimeout: 50,
              idleTimeout: 10
            }
          });

      merged.should.have.keys(['appDir','runAs', 'settings']);
      merged.settings.should.have.keys(['scheduler', 'appDefaults']);
      merged.settings.appDefaults.initTimeout.should.equal(50);
      merged.settings.scheduler.should.have.keys('simple');

    }),
    it('properly overrides data.', function(){
      var appConfig = new AppConfig();
      var merged = appConfig.addLocalConfig({
            appDir: '/dir',
            runAs: 'user',
            settings: {
              scheduler: {
                simple: {}
              },
              appDefaults: {
                initTimeout: 20,
                idleTimeout: 20
              }
            }
          },
          {
            appDefaults: {
              initTimeout: 50,
              idleTimeout: 10
            }
          });

      merged.should.have.keys(['appDir','runAs', 'settings']);
      merged.settings.should.have.keys(['scheduler', 'appDefaults']);
      merged.settings.appDefaults.initTimeout.should.equal(50);
      merged.settings.scheduler.should.have.keys('simple');
    }),
    it('properly merges data.', function(){
      var appConfig = new AppConfig();
      var merged = appConfig.addLocalConfig({
          appDir: '/dir',
          runAs: 'user',
          settings: {
            appDefaults: {
              initTimeout: 20
            }
          }
        },
        {
          scheduler: {
            simple: {}
          },
          appDefaults: {
            initTimeout: 50,
            idleTimeout: 10
          }
        });
      merged.should.have.keys(['appDir','runAs', 'settings']);
      merged.settings.should.have.keys(['scheduler', 'appDefaults']);
      merged.settings.appDefaults.initTimeout.should.equal(50);
      merged.settings.appDefaults.idleTimeout.should.equal(10);
      merged.settings.scheduler.should.have.keys('simple');
    }),
    it('only overrides specific fields.', function(){
      var appConfig = new AppConfig();
      var merged = appConfig.addLocalConfig({
          appDir: '/dir',
          runAs: 'user',
          settings: {
            appDefaults: {
              initTimeout: 20
            }
          }
        },
        {
          scheduler: {
            simple: {}
          },
          appDefaults: {
            initTimeout: 50,
            idleTimeout: 10
          },
          logDir: '/abc'
        });
      merged.should.have.keys(['appDir','runAs', 'settings']);
      merged.settings.should.have.keys(['scheduler', 'appDefaults']); //not logDir
      merged.settings.appDefaults.initTimeout.should.equal(50);
      merged.settings.appDefaults.idleTimeout.should.equal(10);
      merged.settings.scheduler.should.have.keys('simple');
    });
  });
});