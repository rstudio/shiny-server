/*
 * local-config-router.js
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

var AppConfig = require("../config/app-config").AppConfig;
var configRouterUtil = require('./config-router-util');

// Router that supplements an appSpec with the local app config file
//   provided in this app's directory. 
// Historical note: This behavior can't be contained inside the config-
//   router as the appConfig must be aware of the restart timestamp in 
//   order to properly cache the local configurations, so this router
//   must sit /outside/ of the RestartRouter. And that level of caching
//   is important as it can offer 20-30% speedup on connection open.
module.exports = LocalConfigRouter;
function LocalConfigRouter(router, eventBus) {
  this.$router = router;
  this.$appConfig = new AppConfig(eventBus);
}
(function() {
  this.getAppSpec_p = function(req, res) {
    var self = this;
    return this.$router.getAppSpec_p.apply(this.$router, arguments)
    .then(function(appSpec) {
      if (appSpec && typeof(appSpec) === 'object' && self.$allowAppOverride) {
  			// Supplement the global appSpec with a local one, if it exists.
  			return self.$appConfig.readConfig_p(appSpec)
  			.then(function(config){
          if (config){
            // parse the global config
  			    var appSettings = configRouterUtil.parseApplication({}, config);
            // Merge the global config with this app's local conf, if it exists.
            appSpec = self.$appConfig.addLocalConfig(appSpec,
  			       appSettings);
  			  }
  			  return (appSpec);
  			})
        .fail(function(err){
          throw new Error("Invalid local app configuration file: " + err);
        });
      } else {
        return appSpec;
      }
    });
  };

  /**
   * Set whether or not local apps should be allowed to override 
   * global server settings with local .shiny_app.conf files.
   */
  this.setAppOverride = function(enabled){
    this.$allowAppOverride = enabled;
  }
}).call(LocalConfigRouter.prototype);