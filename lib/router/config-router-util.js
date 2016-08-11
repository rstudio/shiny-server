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
var throwForNode = require('../config/schema').throwForNode;

var ALL_PROTOCOLS = {
  "websocket": true,
  "xdr-streaming": true,
  "xhr-streaming": true,
  "iframe-eventsource": true,
  "iframe-htmlfile": true,
  "xdr-polling": true,
  "xhr-polling": true,
  "iframe-xhr-polling": true,
  "jsonp-polling": true
};

/** A set of utility helper functions for config routers.
 */

/**
 * Parse the application section of a config file, whether in
 * a global or local config file.
 * @param settings The settings object into which we should parse
 *   the locNode. This modified object is ultimately returned.
 * @param locNode The config node to parse as an application.
 * @param provideDefaults if true, will provide reasonable defaults
 *   for things like timeouts. Otherwise, will not add any fields
 *   to what's found in the config.
 */
exports.parseApplication = parseApplication;
function parseApplication(settings, locNode, provideDefaults){
  var appSettings = map.create();

  if (provideDefaults){
    // Specify the defaults now -- will overwrite if they're provided for us.
    appSettings.initTimeout = 60;
    appSettings.idleTimeout = 5;
    appSettings.preserveLogs = false;
    appSettings.reconnect = true;
    appSettings.sanitizeErrors = true;
    appSettings.disableProtocols = [];
    appSettings.bookmarkStateDir = '/var/lib/shiny-server/bookmarks';
  }

  if (locNode.getValues('app_idle_timeout') &&
      (locNode.getValues('app_idle_timeout').timeout ||
      locNode.getValues('app_idle_timeout').timeout === 0)){
    appSettings.idleTimeout = locNode.getValues('app_idle_timeout').timeout;
  }
  if (locNode.getValues('app_init_timeout') &&
      locNode.getValues('app_init_timeout').timeout){
    appSettings.initTimeout = locNode.getValues('app_init_timeout').timeout;
  }

  if (locNode.getValues('preserve_logs') &&
      locNode.getValues('preserve_logs').enabled){
    appSettings.preserveLogs = true;
  }

  if (locNode.getOne('reconnect') &&
      locNode.getValues('reconnect').enabled === false) {
    appSettings.reconnect = false;
  }

  if (locNode.getOne('sanitize_errors') &&
      locNode.getValues('sanitize_errors').enabled === false) {
    appSettings.sanitizeErrors = false;
  }

  var disableProtocolsNode = locNode.getOne('disable_protocols', true);
  if (disableProtocolsNode && disableProtocolsNode.values.names) {
    appSettings.disableProtocols = disableProtocolsNode.values.names;
    appSettings.disableProtocols.forEach(function(name) {
      if (!ALL_PROTOCOLS[name]) {
        throwForNode(disableProtocolsNode,
          new Error("Unrecognized protocol " + name));
      }
    });
  }
  if (locNode.getValues('disable_websockets').val){
    appSettings.disableProtocols.push('websocket');
  }

  if (locNode.getOne('bookmark_state_dir') &&
      typeof(locNode.getValues('bookmark_state_dir').dir) === "string") {
    // We don't validate this directory at this time, save that for before we
    // actually launch the app.
    appSettings.bookmarkStateDir = locNode.getValues('bookmark_state_dir').dir;
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

  return settings;
}
