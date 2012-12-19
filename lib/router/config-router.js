var path = require('path');
var util = require('util');
var _ = require('underscore');
var router = require('./router');
var config = require('../config/config');

var throwForNode = require('../config/schema').throwForNode;

exports.createRouter_p = createRouter_p;
function createRouter_p(configPath) {
  return config.read_p(
    configPath, 
    path.join(__dirname, 'shiny-server-rules.config'))
  .then(function(conf) {
    var servers = createServers(conf);
    // TODO: Implement a router to wrap servers
    throw new Error('Not implemented');
  });
}

function createServers(conf) {
  return _.map(conf.search('server'), function(serverNode) {
    // read all locations
    return {
      locations: _.map(serverNode.search('location'), createLocation)
    };
  });
}

function createLocation(locNode) {
  var path = locNode.values.path;
  
  var appdirPath = locNode.getValues('app_dir').path;

  var userappsNode = locNode.getOne('user_apps');
  var userappsEnabled = userappsNode &&
      (userappsNode.values.length == 0 || userappsNode.values.enabled);

  if (appdirPath && userappsEnabled)
    throwForNode(locNode, new Error(
      'A single location cannot have both app_dir and user_apps ' +
      'directives'));

  if (appdirPath) {
    var runas = locNode.getValues('runas').user;
    if (!runas)
      throwForNode(locNode, new Error(
          'Required "runas" directive was not found'));

    var logdir = locNode.getValues('log_dir').path;

    return new router.SingleAppRouter(appdirPath, runas, path, logdir);
  } else if (userappsEnabled) {
    return new router.AutouserRouter(path);
  }

  throwForNode(locNode, new Error(
      'location directive must contain either app_dir or user_apps'));
}