/*
 * app-config.js
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
var config = require('../config/config');
var fsutil = require('../core/fsutil');
var path = require('path');

/**
 * Check to see if there's a configuration file in the given app directory,
 * if so, parse it.
 * @param appDir The base directory in which the application is hosted.
 * @return A promise resolving to the path of the application-specific
 *   configuration file
 */
function findConfig_p(appDir){
  var filePath = path.join(appDir, ".shiny_app.conf");
  return fsutil.safeStat_p(filePath)
  .then(function(stat){
    if (stat && stat.isFile()){
      return (filePath);
    }
    throw new Error('Invalid app configuration file.');
  });
}

exports.readConfig_p = readConfig_p;
function readConfig_p(appSpec){
  //TODO: Cache here, rather than hitting the disk for every request.
  var appDir = appSpec.appDir;

  return findConfig_p(appDir)
  .then(function(confPath){
    return config.read_p(
      confPath, 
      path.join(__dirname, '../router/shiny-server-rules.config'));
  }, function(err){
    // No app configuration file found. Return null.
    return null;
  });
}

/**
 * Supplement the base config with the app-specific config.
 * 
 */ 
 exports.addLocalConfig = addLocalConfig;
function addLocalConfig(baseConfig, appConfig){
  return baseConfig;
  /*
  {
              appDefaults : appSpec.appDefaults,
              scheduler : appSpec.scheduler
            }
            */
}

