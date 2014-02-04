/*
 * render.js
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
var fs = require('fs');
var Handlebars = require('handlebars');
var _ = require('underscore');
var map = require('../core/map');
var paths = require('../core/paths');
var path = require('path');

var templateCache = map.create()

exports.sendPage = sendPage;
function sendPage(response, status, title, options) {
  var config = _.extend({
    contentType: 'text/html; charset=utf-8',
    title: title,
    vars: {},
    headers: {},
    template: 'error'
  }, options);

  var headers = _.extend({
      'Content-Type': config.contentType
  }, config.headers);

  var tmplt;
  if (templateCache[options.templateDir + config.template]){
    tmplt = templateCache[options.templateDir + config.template];
  } else{
    // Follow the hierarchy down to the base page to see if any exist.
    var cascade = config.template.split('-');
    
    // Stores a reference to the best (most precise) candidate we've found in 
    // the custom template directory (if any).
    var bestCustom;

    // Keep arrays of the templates for which we're going to check in order of
    // preference. CustomTemplates will take precence.
    var customTemplates = [];
    var providedTemplates = [];
    
    while (cascade.length > 0){
      var tmpName = cascade.join('-') + '.html';

      if (options.templateDir){
        var customTemplate = path.join(options.templateDir || '', tmpName);
        customTemplates.unshift(customTemplate);
      }
      
      var providedTemplate = paths.projectFile('templates/' + tmpName);
      providedTemplates.unshift(providedTemplate);

      cascade.pop();
    }

    // Create a single array in order of least to most desirable
    var candidates = providedTemplates.concat(customTemplates);

    // Now check to see which of the files exist.
    while(candidates.length > 0 && !tmplt){
      var cand = candidates.pop();
      if (fs.existsSync(cand)){
        tmplt = fs.readFileSync(cand, 'utf-8');
      }
    }

    if (!tmplt){
      throw new Error("No template available for type: " + config.template);
    }

    // Cache the retrieved template.
    templateCache[options.templateDir + config.template] = tmplt;
  }

  var template = Handlebars.compile(tmplt);

  response.writeHead(status, headers);
  response.end(template(_.extend({title: title}, config.vars)));
}

exports.sendClientConsoleMessage = sendClientConsoleMessage;
/**
 * Sends the given string to the client, where it will be printed to the
 * JavaScript error console (if available).
 */
function sendClientConsoleMessage(ws, message) {
  var msg = JSON.stringify({
    custom: {
      console: message
    }
  });
  ws.write(msg);
}

exports.sendClientAlertMessage = sendClientAlertMessage;
/**
 * Sends the given string to the client, where it will be displayed as a
 * JavaScript alert message.
 */
function sendClientAlertMessage(ws, alert) {
  var msg = JSON.stringify({
    custom: {
      alert: alert
    }
  });
  ws.write(msg);
}

exports.error404 = error404;
// Send a 404 error response
function error404(req, res, templateDir) {
  sendPage(res, 404, 'Page not found', {
    template: 'error-404',
    templateDir: templateDir,
    vars: {
      message: "Sorry, but the page you requested doesn't exist."
    }
  });
}

exports.errorAppOverloaded = errorAppOverloaded;
// Send a 503 error response
function errorAppOverloaded(req, res, templateDir) {
  sendPage(res, 503, 'Too Many Users', {
    template: 'error-503-users',
    templateDir: templateDir,    
    vars: {
      message: "Sorry, but this application has exceeded its quota of concurrent users. Please try again later."
    }
  });
}

exports.flushCache = flushCache;
function flushCache(){
  templateCache = map.create();
}