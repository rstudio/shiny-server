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
  "eventsource": true,
  "iframe-eventsource": true,
  "htmlfile": true,
  "iframe-htmlfile": true,
  "xdr-polling": true,
  "xhr-polling": true,
  "iframe-xhr-polling": true,
  "jsonp-polling": true
};

var META_PROTOCOLS = {
  "streaming": ["xdr-streaming", "iframe-htmlfile", "htmlfile", "xhr-streaming", "iframe-eventsource", "eventsource"],
  "polling": ["jsonp-polling", "xdr-polling", "iframe-xhr-polling", "xhr-polling"]
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

  appSettings.logFileMode = "640";
  let logFileModeNode = locNode.getOne('log_file_mode');
  if (logFileModeNode && logFileModeNode.values.mode) {
    appSettings.logFileMode = logFileModeNode.values.mode;
    // Ensure it is an octal string
    if (!/^[0-8]+$/.test(appSettings.logFileMode)) {
      throwForNode(logFileModeNode, new Error('Log file mode must be an octal string'));
    }
  }
  if (locNode.getOne('frame_options')) {
    appSettings.frameOptions = parseFrameOptions(locNode.getOne('frame_options'));
  }

  if (locNode.getOne('reconnect') &&
      locNode.getValues('reconnect').enabled === false) {
    appSettings.reconnect = false;
  }

  if (locNode.getValues('reconnect_timeout') &&
      locNode.getValues('reconnect_timeout').timeout){
      appSettings.reconnectTimeout = locNode.getValues('reconnect_timeout').timeout;
  }

  if (locNode.getOne('sanitize_errors') &&
      locNode.getValues('sanitize_errors').enabled === false) {
    appSettings.sanitizeErrors = false;
  }

  var disableProtocolsNode = locNode.getOne('disable_protocols', true);
  if (disableProtocolsNode && disableProtocolsNode.values.names) {
    appSettings.disableProtocols = disableProtocolsNode.values.names.reduce(
      (accum, name) => {
        if (ALL_PROTOCOLS[name]) {
          return accum.concat([name]);
        } else if (META_PROTOCOLS[name]) {
          return accum.concat(META_PROTOCOLS[name]);
        } else {
          throwForNode(disableProtocolsNode,
            new Error("Unrecognized protocol " + name));
        }
      },
      []
    );

    // htmlfile and eventsource are new for SockJS 1.x. Some admins configure
    // Shiny Server to disable all protocols except the one(s) they prefer;
    // introducing new protocols might be problematic. Take a conservative
    // approach by disabling the new transports if their iframe-assisted
    // siblings are disabled. Note that this makes it impossible to use the
    // new versions but NOT the iframe versions.
    if (appSettings.disableProtocols.find(x => x === 'iframe-htmlfile')) {
      appSettings.disableProtocols.push('htmlfile');
    }
    if (appSettings.disableProtocols.find(x => x === 'iframe-eventsource')) {
      appSettings.disableProtocols.push('eventsource');
    }
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

exports.parseFrameOptions = parseFrameOptions;
function parseFrameOptions(node) {
  if (!node)
    return void 0;

  var frameOptions = node.values.value.toUpperCase();
  if (frameOptions === 'DENY' || frameOptions === 'SAMEORIGIN') {
    return frameOptions;
  } else if (frameOptions === 'ALLOW') {
    // Don't add frame options
  } else if (frameOptions === 'ALLOW-FROM') {
    var frameOptionsUrl = node.values.url;
    if (/\s/.test(frameOptionsUrl)) {
      throwForNode(node, new Error('Invalid URL'));
    }
    return frameOptions + " " + frameOptionsUrl;
  } else {
    throwForNode(node,
      new Error('Invalid frame_options value: expected one of "allow", "deny", "sameorigin", or "allow-from <url>".'));
  }
}
