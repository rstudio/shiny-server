/*
 * user-dirs-router.js
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

var Q = require('q');
var qutil = require('../core/qutil');
var posix = require('../../build/Release/posix');
var AppSpec = require('../worker/app-spec');
var regexp_quote = require('../core/re-quote');
var fs = require('fs');
var path = require('path');
var url = require('url');
var _ = require('underscore');
var DirectoryRouter = require('./directory-router');

module.exports = UserDirsRouter;
/**
 * @param runas An optional object representing the run_as object in the config 
 *   file at this location. If not provided, apps will respect the runas setting.
 *   If falsey, it will run as the user to whom the application belongs (as 
 *   determined by the URL).
 **/
function UserDirsRouter(prefix, groups, settings, runas, dirIndex) {
  prefix = prefix.replace(/\/$/m, ''); // strip trailing slash, if any
  this.$prefix = prefix;
  this.$groups = groups || [];
  this.$settings = settings || {};
  this.$runas = runas;
  this.$dirIndex = dirIndex || false;
  this.$rePath = new RegExp(
      '^' + regexp_quote(prefix) + '/([^/]+)(?=/|$)');
}

(function() {
  this.getAppSpec_p = function(req, res) {
    var reqUrl = url.parse(req.url);
    var m = this.$rePath.exec(reqUrl.pathname);
    if (!m)
      return Q(null);

    var prefix = m[0];
    
    var username = m[1];
    var runas = _.clone(this.$runas);
    if (!runas){
      // In user_apps mode, we don't pass in a run_as. Expected that we'd use
      // the username.
      runas = username;
    } else{
      var homeIndex;
      // Replace any instance of ':HOME_USER:' with the username from the URL.
      while ((homeIndex = _.indexOf(runas, ':HOME_USER:')) >= 0){    
        runas[homeIndex] = username;
      }
    }

    var pw = posix.getpwnam(username);
    if (!pw)
      return Q(null);

    if (this.$groups.length) {
      // Check if user is a member of one of the required groups
      if (!_.intersection(posix.getgrouplist(username), this.$groups).length)
        return Q(null);
    }

    var dir = path.join(pw.home, 'ShinyApps');
    var logDir = path.join(pw.home, 'ShinyApps', 'log');
    try {
      fs.mkdirSync(logDir, '755');
      fs.chownSync(logDir, pw.uid, pw.gid);
    } catch (ex) {
      try {
        var stat = fs.statSync(logDir);
        if (!stat.isDirectory()) {
          logger.error('Log directory existed, was a file: ' + logDir);
          logDir = null;
        }
      } catch (ex2) {
        logger.error('Log directory creation failed: ' + ex2.message);
        logDir = null;
      }
    }

    var settings = JSON.parse(JSON.stringify(this.$settings));

    var dirRouter = new DirectoryRouter(dir, runas, this.$dirIndex, prefix, 
      logDir, this.$settings, /^(\/)?log(\/)?/); // Exclude log dir.

    return dirRouter.getAppSpec_p(req, res);
  };
}).call(UserDirsRouter.prototype);
