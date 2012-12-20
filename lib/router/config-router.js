var assert = require('assert');
var path = require('path');
var util = require('util');
var stable = require('stable');
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
    return new ConfigRouter(createServers(conf));
  });
}

function ConfigRouter(servers) {
  this.servers = servers;
}
(function() {
  this.getAppSpec = function(req, res) {
    var scored = _.map(this.servers, function(server) {
      return {
        server: server,
        score: server.getScore(req, res)
      };
    });

    // Stable sort the scored servers; higher scores at the beginning
    stable(scored, function(a, b) {
      return a.score < b.score
    });

    var result;
    for (var i = 0; i < scored.length; i++) {
      if (scored[i].score <= 0)
        return null;
      result = scored[i].server.getAppSpec(req, res);
      // Handled!
      if (result)
        return result;
    }
    return null;
  };
}).call(ConfigRouter.prototype);

/**
 * Crawl the parsed and validated config file data to create an array of
 * ServerRouters.
 */
function createServers(conf) {
  var servers = _.map(conf.search('server'), function(serverNode) {
    // read all locations
    var port = serverNode.getValues('listen').port;
    if (typeof port === 'undefined')
      port = 80;
    if (port <= 0)
      throwForNode(serverNode.getOne('listen'),
          new Error('Invalid port number'));

    var host = serverNode.getValues('listen').host || '0.0.0.0';

    var serverName = serverNode.getValues('server_name').name;

    var locations = _.map(serverNode.search('location'), createLocation);

    return new ServerRouter(port, host, serverName, locations);
  });

  _.map(servers, function(server) {
    return (server.host || '') + ':' + server.port;
  });

  return servers;
}

/**
 * Delegates requests to sub-routers (locations). Can indicate how well its
 * configuration matches up to a request (`getScore`).
 */
function ServerRouter(port, host, vhost, locations) {
  assert(port);
  assert(host);
  this.port = port;
  this.host = host;
  this.vhost = (vhost || '').toLowerCase();
  this.$locations = locations;
}
(function() {
  /**
   * This score helps determine the order in which servers will be tried for
   * a given request. Higher scores are tried first, and if two servers have
   * the same score then they are tried in the order they are found in the
   * configuration file.
   *
   * A score of 0 or lower means failure--the server is not able to handle
   * the request.
   *
   * - Matching local port number: 0 points
   * - Non-matching local port number: fail
   *
   * - Server has wildcard (* or 0.0.0.0) for host: 1 point
   * - Server has same local IP address as request: 2 points
   * - Non-wildcard host server and differing request host: fail
   *
   * - Server has no virtual host: 0 points
   * - Server has same virtual host: 3 points
   * - Server has differing virtual host: fail
   */
  this.getScore = function(req, res) {
    var score = 0;

    var address = req.address || req.connection.address();
    var port = address.port;
    var host = address.address;
    
    if (port != this.port)
      return 0;
    
    if (this.host == '0.0.0.0' || this.host == '*')
      score += 1;
    else if (this.host == host)
      score += 2;
    else
      return 0;

    // Virtual hosts not yet supported--need pull request #105 on sockjs
    // https://github.com/sockjs/sockjs-node/pull/105
    /*
    if (this.vhost) {
      if (this.vhost == (req.headers.host || '').toLowerCase()) {
        score += 3;
      } else {
        return 0;
      }
    }
    */

    assert(score > 0);
    return score;
  };

  this.getAppSpec = function(req, res) {
    assert(this.getScore(req, res) > 0);
    for (var i = 0; i < this.$locations.length; i++) {
      var result = this.$locations[i].getAppSpec(req, res);
      if (result)
        return result;
    }
    return null;
  };
}).call(ServerRouter.prototype);

/**
 * Validates the location node, and returns the appropriate type of router
 * it represents.
 */
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
