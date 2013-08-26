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
 */
exports.parseApplication = parseApplication;
function parseApplication(settings, locNode){
  var appSettings = locNode.getValues('application');
  if (_.size(appSettings) > 0){
    settings.appDefaults = appSettings;

    var appNode = locNode.getOne('application');

    //try to load in one of the various schedulers.
    var scheduler = appNode.getOne('utilization_scheduler');
    if (scheduler){
      var params = appNode.getValues('utilization_scheduler');
      scheduler = {utilization: params};
    } else {
      var params = appNode.getValues('simple_scheduler');
      scheduler = {simple: params};
    }
    settings.scheduler = scheduler;
  } else{
    settings.appDefaults = map.create();
    settings.appDefaults.sessionTimeout = 0;
  
    settings.scheduler = {simple: {maxRequests: 100}};
  }
  return settings;
}