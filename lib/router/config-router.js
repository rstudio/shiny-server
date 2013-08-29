/*
 * config-router.js
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
// TODO: Drop root whenever possible
var assert = require('assert');
var path = require('path');
var util = require('util');
var stable = require('stable');
var _ = require('underscore');
var map = require('../core/map');
var permissions = require('../core/permissions');
var qutil = require('../core/qutil');
var router = require('./router');
var config = require('../config/config');
var posix = require('../../build/Release/posix');
var DirectoryRouter = require('./directory-router');
var throwForNode = require('../config/schema').throwForNode;
var configRouterUtil = require('./config-router-util');

exports.createRouter_p = createRouter_p;
function createRouter_p(configPath, schedulerRegistry) {
  return config.read_p(
    configPath, 
    path.join(__dirname, 'shiny-server-rules.config'))
  .then(function(conf) {
    checkPermissions(conf);
    return new ConfigRouter(conf, schedulerRegistry);
  });
}

function checkPermissions(conf) {
  // run_as nodes that can't be obeyed due to permissions
  var users = _.filter(conf.search('run_as', false), function(node) {
    return !permissions.canRunAs(node.values.user);
  });
  // user_apps nodes (the mere presence of these means root is needed)
  var userapps = conf.search('user_apps', false);
  // Listen nodes with ports under 1024
  var listens = _.filter(conf.search('listen', false), function(node) {
    return node.values.port < 1024;
  });

  // Array of strings representing unique users to run_as
  var uniqueUsers = _.chain(conf.search('run_as', false))
      .map(function(node) {
        return node.values.user;
      })
      .uniq()
      .value();

  if (permissions.isSuperuser()) {
    // Check if superuser is actually necessary
    if (uniqueUsers.length == 1 && !userapps.length && !listens.length) {
      logger.warn('Running as root unnecessarily is a security risk! You could be running more securely as non-root.');
    }

    return;
  }

  // If we got here, we're not running as root

  if (users.length) {
    var user = users[0].values.user;
    throwForNode(users[0],
        new Error("The user '" + permissions.getProcessUser() + "' does not have permissions to run applications as user '" + user + "'. Please restart shiny-server as user '" + user + "'."));
  }

  if (userapps.length) {
    throwForNode(userapps[0], 
        new Error('shiny-server must be run as root to use the user_apps directive'));
  }

  if (listens.length) {
    var port = listens[0].values.port;
    throwForNode(listens[0],
        new Error("The user '" + permissions.getProcessUser() + "' does not have permission to listen on port " + port + ". Please choose a port number of 1024 or above, or restart shiny-server as root."));
  }
}

function ConfigRouter(conf, schedulerRegistry) {
  this.servers = createServers(conf);
  this.accessLogSpec = createAccessLogSpec(conf.getOne('access_log'));
  this.socketDir = conf.getValues('socket_dir').path;
  this.$allowAppOverride = conf.getValues('allow_app_override').enabled;
}
(function() {
  this.getAppSpec_p = function(req, res) {
    var self = this;
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
    return router.getFirstAppSpec_p(_.pluck(scored, 'server'), req, res)
    .then(function(appSpec){
      if (!appSpec || !appSpec.appDir){
        //occurs when no router is found to handle the request
        return appSpec;
      }
      return appSpec;
    })
    
  };

  this.getAddresses = function() {
    return _.map(this.servers, function(server) {
      return { address: server.host, port: server.port };
    });
  };

  this.getAppOverride = function(){
    return this.$allowAppOverride;
  }
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

function createAccessLogSpec(accessLogNode) {
  if (!accessLogNode)
    return null;
  return {
    path: accessLogNode.values.path,
    format: accessLogNode.values.format
  };
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

    if (!req.address && !req.connection) {
      logger.warn('Request with no address and no connection: ' + util.inspect(req));
      return 0;
    }

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

  var sitedirPath = locNode.getValues('site_dir').rootPath;
  
  var appdirPath = locNode.getValues('app_dir').path;

  var userappsNode = locNode.getOne('user_apps');
  var userappsEnabled = userappsNode &&
      (userappsNode.values.length == 0 || userappsNode.values.enabled);

  var redirectNode = locNode.getOne('redirect');
  var redirectArgs = locNode.getValues('redirect');

  var applications = extractApplications(locNode);

  var settings = map.create();
  var gaid = locNode.getValues('google_analytics_id').gaid;
  if (gaid)
    settings.gaTrackingId = gaid;

  if (appdirPath && userappsEnabled)
    throwForNode(locNode, new Error(
      'A single location cannot have both app_dir and user_apps ' +
      'directives'));
  settings = configRouterUtil.parseApplication(settings, locNode, true);

  if (sitedirPath || appdirPath) {
    var runas = locNode.getValues('run_as').user;
    if (!runas)
      throwForNode(locNode, new Error(
          'Required "run_as" directive was not found'));

    var logdir = locNode.getValues('log_dir').path;
    if (!logdir)
      throwForNode(locNode, new Error(
          'Required "log_dir" directive was not found'));

    if (sitedirPath) {
      var dirIndex = !!locNode.getValues('directory_index').enabled;
      return new DirectoryRouter(sitedirPath, runas, dirIndex, path, logdir,
      	  settings, applications);
    } else {
      assert(appdirPath);
      if (_.size(applications) > 0){
        logger.warn("'application' settings aren't supported in app_dir blocks.");
      }
      return new router.SingleAppRouter(
          appdirPath, runas, path, logdir, settings);
    }
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
    return new router.AutouserRouter(path, groups, settings, applications);
  } else if (redirectNode) {
    return new router.RedirectRouter(
      path, redirectArgs.url, redirectArgs.statusCode, redirectArgs.exact);
  }

  throwForNode(locNode, new Error(
      'location directive must contain either app_dir or user_apps'));
}

/**
 * Identify all 'application' blocks within the given location node and
 * return a hash of those applications indexed by their appDir.
 */
function extractApplications(locNode){
  var appArray = locNode.getAll("application");
  var apps = map.create();
  _.each(appArray, function(app){
    apps[app.values.appDir] = app;  
  });
  return apps;
}