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
var userDb = require('../core/user-db');
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
    var self = this;
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

    // A missing user or nonmember falls through (null -> 404), exactly as
    // before; operational lookup errors reject.
    return Q(userDb.lookupUser_p(username))
    .then(function(pw) {
      if (!pw)
        return null;

      var membership_p;
      if (self.$groups.length) {
        // Check if user is a member of one of the required groups
        membership_p = Q(userDb.getGroupIds_p(username))
        .then(function(gids) {
          return !!gids && _.intersection(gids, self.$groups).length > 0;
        });
      } else {
        membership_p = Q(true);
      }

      return membership_p.then(function(isMember) {
        if (!isMember)
          return null;

        var dir = path.join(pw.home, 'ShinyApps');
        var logDir = path.join(pw.home, 'ShinyApps', 'log');
        var settings = JSON.parse(JSON.stringify(self.$settings));

        var dirRouter = new DirectoryRouter(dir, runas, self.$dirIndex, prefix,
          logDir, self.$settings, /^(\/)?log(\/)?/); // Exclude log dir.

        return dirRouter.getAppSpec_p(req, res);
      });
    });
  };
}).call(UserDirsRouter.prototype);
