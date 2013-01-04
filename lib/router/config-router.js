var assert = require('assert');
var path = require('path');
var util = require('util');
var stable = require('stable');
var _ = require('underscore');
var map = require('../core/map');
var qutil = require('../core/qutil');
var router = require('./router');
var config = require('../config/config');
var posix = require('../../build/Release/posix');

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
  this.getAppSpec_p = function(req, res) {

    var scored = _.map(this.servers, function(server) {
      return {
        server: server,
        score: server.getScore(req, res)
      };
    });

    // Ignore servers that don't match
    scored = _.filter(scored, function(serverWithScore) {
      return serverWithScore.score > 0;
    });

    // Stable sort the scored servers; higher scores at the beginning
    scored = stable(scored, function(a, b) {
      return a.score < b.score
    });

    // Return a promise that resolves to serially calling each server's
    // getAppSpec_p and returning the first non-falsy result
    return router.getFirstAppSpec_p(_.pluck(scored, 'server'), req, res);
  };

  this.getAddresses = function() {
    return _.map(this.servers, function(server) {
      return { address: server.host, port: server.port };
    });
  };
}).call(ConfigRouter.prototype);

/**
 * Crawl the parsed and validated config file data to create an array of
 * ServerRouters.
 */
function createServers(conf) {
  var seenKeys = map.create();

  var servers = _.map(conf.search('server'), function(serverNode) {
    var listenNode = serverNode.getOne('listen');
    if (!listenNode)
      throwForNode(serverNode,
          new Error('Required "listen" directive is missing'));

    var port = serverNode.getValues('listen').port;
    if (typeof port === 'undefined')
      port = 80;
    if (port <= 0)
      throwForNode(listenNode, new Error('Invalid port number'));

    var host = serverNode.getValues('listen').host || '0.0.0.0';
    if (host === '*')
      host = '0.0.0.0';

    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      throwForNode(listenNode,
          new Error('Invalid IPv4 address "' + host + '"'));
    }

    var serverNames = serverNode.getValues('server_name').names;

    // read all locations
    var locations = _.map(serverNode.search('location'), createLocation);

    var key = host + ':' + port;
    if (seenKeys[key])
      throwForNode(listenNode,
          new Error(key + ' combination conflicts with earlier server definition'));
    seenKeys[key] = true;

    return new ServerRouter(port, host, serverNames, locations);
  });

  return servers;
}

/**
 * Delegates requests to sub-routers (locations). Can indicate how well its
 * configuration matches up to a request (`getScore`).
 */
function ServerRouter(port, host, vhosts, locations) {
  assert(port);
  assert(host);
  this.port = port;
  this.host = host;
  this.vhosts = _.invoke(vhosts || [], 'toLowerCase');
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
    var vhost = (req.headers.host || '').split(/:/)[0].toLowerCase();
    if (!req.headers.host) {
      logger.warn('No host header sent by user-agent ' + req.headers['user-agent']);
    }
    if (port != this.port)
      return 0;
    
    if (this.host == '0.0.0.0' || this.host == '*')
      score += 1;
    else if (this.host == host)
      score += 2;
    else
      return 0;

    if (this.vhosts.length > 0) {
      // TODO: Support non-literal server_name values
      // http://nginx.org/en/docs/http/ngx_http_core_module.html#server_name
      var found = _.find(this.vhosts, function(vh) {
        return vh === vhost;
      });
      if (found) {
        score += 3;
      } else {
        return 0;
      }
    }

    assert(score > 0);
    return score;
  };

  this.getAppSpec_p = function(req, res) {
    assert(this.getScore(req, res) > 0);

    // Return a promise that resolves to serially calling each location's
    // getAppSpec_p and returning the first non-falsy result
    return router.getFirstAppSpec_p(this.$locations, req, res);
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

  var redirectNode = locNode.getOne('redirect');
  var redirectArgs = locNode.getValues('redirect');

  var settings = map.create();
  var gaid = locNode.getValues('google_analytics_id').gaid;
  if (gaid)
    settings.gaTrackingId = gaid;

  if (appdirPath && userappsEnabled)
    throwForNode(locNode, new Error(
      'A single location cannot have both app_dir and user_apps ' +
      'directives'));

  if (appdirPath) {
    var runas = locNode.getValues('run_as').user;
    if (!runas)
      throwForNode(locNode, new Error(
          'Required "run_as" directive was not found'));

    var logdir = locNode.getValues('log_dir').path;
    if (!logdir)
      throwForNode(locNode, new Error(
          'Required "log_dir" directive was not found'));

    return new router.SingleAppRouter(
        appdirPath, runas, path, logdir, settings);
  } else if (userappsEnabled) {
    var groupsNode = locNode.getOne('members_of');
    var groups = locNode.getValues('members_of').groups || [];
    // groups is a list of group names; map it to a list of numeric group IDs
    groups = _.map(groups, function(group) {
      try {
        var groupInfo = posix.getgrnam(group);
        if (!groupInfo) {
          throwForNode(groupsNode,
              new Error('Group "' + group + '" does not exist'));
        }
      } catch (ex) {
        throwForNode(groupsNode, ex);
      }
      return groupInfo.gid;
    });
    return new router.AutouserRouter(path, groups, settings);
  } else if (redirectNode) {
    return new router.RedirectRouter(
      path, redirectArgs.url, redirectArgs.statusCode, redirectArgs.exact);
  }

  throwForNode(locNode, new Error(
      'location directive must contain either app_dir or user_apps'));
}
