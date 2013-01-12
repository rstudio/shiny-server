/*
 * makedocs.js
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

/*
 * This script is for generating config.html. It is designed to run under
 * node-supervisor (https://github.com/isaacs/node-supervisor).
 *
 *   supervisor -n exit --extensions 'js|html' lib/makedocs.js
 */

var fs = require('fs');
var path = require('path');
var util = require('util');
var Handlebars = require('handlebars');
var _ = require('underscore');
var config = require('./config/config.js');
var schema = require('./config/schema.js');


function filterDesc(desc) {
  if (!desc)
    return desc;

  return desc.replace(/`(.*?)`/g, '<code>$1</code>');
}


var packageInfo =
  JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json')));
var version = packageInfo['version'];

var rulesPath = path.join(__dirname, 'router/shiny-server-rules.config');
var ruleConfig = config.parse(fs.readFileSync(rulesPath, 'utf-8'), rulesPath);

var rules = _.map(ruleConfig.children, function(child) {
  var name = child.name;
  var desc = filterDesc(child.getOne('desc').args[0]);
  var params = _.map(child.getAll('param'), function(param) {
    return new schema.ConfigSchemaParam(param);
  });
  var at = _.map(child.getOne('at').args, function(loc) {
    return (loc == '$') ? 'Top-level' : loc;
  });
  var primaryLoc = _.last(at);
  var otherLocs = _.clone(at);
  otherLocs.pop();
  otherLocs = otherLocs.join(', ');

  return {
    name: name,
    version: packageInfo['version'],
    desc: filterDesc(desc),
    params: params,
    at: at,
    primaryLoc: primaryLoc,
    otherLocs: otherLocs
  }
});

var template = Handlebars.compile(fs.readFileSync(path.join(__dirname, '../templates/config.html'), 'utf-8'));
fs.writeFileSync(
  path.join(__dirname, '../config.html'),
  template({
    version: version,
    directives: rules
  }),
  'utf-8'
);
