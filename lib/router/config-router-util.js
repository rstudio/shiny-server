/*
 * config-router-util.js
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
var map = require('../core/map');

/** A set of utility helper functions for config routers.
 */

/**
 * Parse the application section of a config file, whether in
 * a global or local config file.
 * @param provideDefaults if true, will provide reasonable defaults
 *   for things like timeouts. Otherwise, will not add any fields
 *   to what's found in the config.
 */
exports.parseApplication = parseApplication;
function parseApplication(settings, locNode, provideDefaults){
  var appSettings = map.create();

  if (provideDefaults){
    appSettings.initTimeout = locNode.getValues('app_init_timeout').timeout || 60;
    appSettings.idleTimeout = locNode.getValues('app_idle_timeout').timeout || 5;
  }

  settings.appDefaults = appSettings;

  //try to load in the Simple Scheduler's settings.
  var scheduler = locNode.getOne('simple_scheduler');
  if (scheduler){
    var params = locNode.getValues('simple_scheduler');
    settings.scheduler = {simple: params};
  } else{
    settings.scheduler = {simple: {maxRequests: 100}};
  }
  
  if (provideDefaults){
    settings.appDefaults.sessionTimeout = 0;
  }
  
  return settings;
}