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

    // Stores a reference to the best (most precise) provided template we have.
    var bestProvided;
    
    while (cascade.length > 0){
      var tmpName = cascade.join('-') + '.html';

      var customTemplate = path.join(options.templateDir || '', tmpName);
      if (options.templateDir && 
          fs.existsSync(customTemplate)){
        // Custom template exists
        if (!bestCustom){
          // We haven't found a better custom template, so use this one.
          bestCustom = customTemplate;
        }
      }
      
      var providedTemplate = paths.projectFile('templates/' + tmpName);
      if (fs.existsSync(providedTemplate)){
        // Provided template exists.
        if (!bestProvided){
          // We haven't found a better custom template, so use this one.
          bestProvided = providedTemplate;  
        }        
      }

      cascade.pop();
    }

    // Now we know the best custom and provided template we have.
    if (bestCustom){
      // We should use the custom template over any default
      tmplt = fs.readFileSync(bestCustom, 'utf-8');
    } else{
      // We'll have to use the best provided template
      tmplt = fs.readFileSync(bestProvided, 'utf-8');
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
function error404(req, res) {
  sendPage(res, 404, 'Page not found', {
    template: 'error-404',
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

//TODO: Wire this up to SIGHUP
exports.flushCache = flushCache;
function flushCache(){
  templateCache = map.create();
}