/*
 * squash-run-as-router.js
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

/**
 * Squash the runas array down to a single, non-special username, or undefined 
 * if it doesn't find any acceptable users.
 *
 * Any username that matches /^:.*:$/ will be treated as a special username.
 * Internal routers may replace such special usernames as they see fit. This
 * router will be the outer-most and will condense the array of runAs users 
 * down to a single user. Any username that is not a string will not be
 * considered as a candidate.
 **/

 var _ = require('underscore');

module.exports = SquashRouter;
function SquashRouter(router) {
  this.$router = router;
}
(function() {
  this.getAppSpec_p = function(req, res) {
    return this.$router.getAppSpec_p.apply(this.$router, arguments)
    .then(function(appSpec) {
      if (appSpec && typeof(appSpec) === 'object' && 
          appSpec.runAs && _.isArray(appSpec.runAs)) {
        appSpec.runAs = _.find(appSpec.runAs, function(user){
          if (!_.isString(user))
            return false;
          
          return !(/^:.*:$/.test(user));
        });
      }

      return appSpec;      
    });
  };
}).call(SquashRouter.prototype);
