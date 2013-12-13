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

var AppConfig = require('../lib/config/app-config').AppConfig;
var SimpleEventBus = require('../lib/events/simple-event-bus');

describe('AppConfig', function(){
  describe('#addLocalConfig', function(){
    it('properly supplements data.', function(){
      var appConfig = new AppConfig(new SimpleEventBus());
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
      Object.keys(merged.settings.scheduler).should.eql(['simple']);

    }),
    it('properly overrides data.', function(){
      var appConfig = new AppConfig(new SimpleEventBus());
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
      Object.keys(merged.settings.scheduler).should.eql(['simple']);
    }),
    it('properly merges data.', function(){
      var appConfig = new AppConfig(new SimpleEventBus());
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
      Object.keys(merged.settings.scheduler).should.eql(['simple']);
    }),
    it('only overrides specific fields.', function(){
      var appConfig = new AppConfig(new SimpleEventBus());
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
      Object.keys(merged.settings.scheduler).should.eql(['simple']);
    }),
    it('passes app settings through when replacing sched.', function(){
      var appConfig = new AppConfig(new SimpleEventBus());
      var merged = appConfig.addLocalConfig({
          appDir: '/dir',
          runAs: 'user',
          settings: {
            appDefaults: {
              initTimeout: 60,
              idleTimeout: 20
            },
            scheduler: {simple: {maxRequests: 100}},
            restart: 1232132
          }
        },
        {
          scheduler: {
            simple: {maxRequests: 3}
          },
          appDefaults: { },
          logDir: '/abc'
        });
      Object.keys(merged.settings.appDefaults).length.should.equal(2);
    });
  });
});