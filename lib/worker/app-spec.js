/*
 * app-spec.js
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

var AppSpec = function(appDir, runAs, prefix, logDir, settings) {
  this.appDir = appDir;
  this.runAs = runAs;
  this.prefix = prefix;
  this.logDir = logDir;
  this.settings = settings;
};
module.exports = AppSpec;

(function() {

  this.getKey = function() {
    return this.appDir + "\n" +
      this.runAs + "\n" +
      this.prefix + "\n" +
      this.logDir + "\n" +
      JSON.stringify(this.settings);
  };

}).call(AppSpec.prototype);