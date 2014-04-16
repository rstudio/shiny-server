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
var paths = require('../core/paths');
var permissions = require('../core/permissions');
var qutil = require('../core/qutil');
var router = require('./router');
var UserDirsRouter = require('./user-dirs-router');
var config = require('../config/config');
var posix = require('../../build/Release/posix');
var DirectoryRouter = require('./directory-router');
var throwForNode = require('../config/schema').throwForNode;
var configRouterUtil = require('./config-router-util');

exports.createRouter_p = createRouter_p;
function createRouter_p(configPath, schedulerRegistry) {
  return config.read_p(
    configPath, 
    paths.projectFile('config/shiny-server-rules.config'))
  .then(function(conf) {
    checkPermissions(conf);
    return new ConfigRouter(conf, schedulerRegistry);
  });
}

function checkPermissions(conf) {
  // run_as nodes that can't be obeyed due to permissions
  var users = _.filter(conf.search('run_as', false), function(node) {
    return _.some(node.values.users, function(user){
      return !permissions.canRunAs(user);
    });
  });

  // user_apps nodes (the mere presence of these means root is needed)
  var userapps = conf.search('user_apps', false);
  var userdirs = conf.search('user_dirs', false);

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
    if (uniqueUsers.length == 1 && (userapps.length + userdirs.length == 0)&& !listens.length) {
      logger.warn('Running as root unnecessarily is a security risk! You could be running more securely as non-root.');
    }

    return;
  }

  // If we got here, we're not running as root

  if (users.length) {
    var userLine = users[0].values.users;
    throwForNode(users[0],
        new Error("The user '" + permissions.getProcessUser() + "' does not have permissions to run applications as one of the users in '" + 
          userLine.join(',') + 
          "'. Please restart shiny-server as one of the users in  '" + 
          userLine.join(',') + "'."));
  }

  if (userapps.length) {
    throwForNode(userapps[0], 
        new Error('shiny-server must be run as root to use the user_apps directive'));
  }
  if (userdirs.length) {
    throwForNode(userdirs[0], 
        new Error('shiny-server must be run as root to use the user_dirs directive'));
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
  this.$disableWebsockets = conf.getValues('disable_websockets').val || false;
  this.$templateDir = conf.getValues('template_dir').dir;
  
  var apps = conf.search("application", true);
  if (apps && apps.length > 0){
    logger.error("The `application` configuration has been deprecated. Please "+ 
      "see http://rstudio.github.io/shiny-server/latest/#location for more " +
      "information on how to adjust your configuration file.");
    process.exit(1);
  }
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

  this.getWebsocketsDisabled = function(){
    return this.$disableWebsockets;
  }

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

    // Read all locations. Use post-order traversal so that nested locs
    // get priority over their parents.
    var locations = _.chain(serverNode.search('location', false, true))
    .map(createLocation)
    .compact()
    .value();

    // We get the templateDir at the server level so that a global or server-
    // wide templateDir can be attached to the request directly. We may need
    // this if a page gets returns without a matching AppSpec (like a 404).
    var templateDir = serverNode.getValues('template_dir').dir;

    _.each(serverNames || [''], function(serverName) {
      var key = host + ':' + port;
      if (serverName !== '')
        key += '(' + serverName + ')';
      if (seenKeys[key])
        throwForNode(listenNode,
            new Error(key + ' combination conflicts with earlier server definition'));
      seenKeys[key] = true;
    });

    return new ServerRouter(port, host, serverNames, locations, templateDir);
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
function ServerRouter(port, host, vhosts, locations, templateDir) {
  assert(port);
  assert(host);
  this.port = port;
  this.host = host;
  this.vhosts = _.invoke(vhosts || [], 'toLowerCase');
  this.$locations = locations;
  this.$templateDir = templateDir;
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

    // Attach the templateDir directly to the request so that we can properly
    // generate pages without needing an AppSpec.
    req.templateDir = this.$templateDir;

    // Return a promise that resolves to serially calling each location's
    // getAppSpec_p and returning the first non-falsy result
    return router.getFirstAppSpec_p(this.$locations, req, res);
  };
}).call(ServerRouter.prototype);

function joinUrlParts(a, b) {
  return a.replace(/\/$/, '') + '/' + b.replace(/^\//, '');
}

function deriveLocationPath(locNode) {
  var path = locNode.values.path;
  while (locNode.parent && locNode.parent.name === 'location') {
    locNode = locNode.parent;
    path = joinUrlParts(locNode.values.path, path);
  }
  if (!/^\//.test(path))
    path = '/' + path;
  return path;
}

function createSiteDir(locNode, node, settings) {
  var locPath = deriveLocationPath(locNode);
  var rootPath = deriveLocationPath(node.parent);

  var sitedirPath = locNode.getValues('site_dir').rootPath;

  var runas = locNode.getValues('run_as').users;
  if (!runas || runas.length == 0)
    throwForNode(locNode, new Error(
        'Required "run_as" directive not present or has no users.'));

  var logdir = locNode.getValues('log_dir').path;
  if (!logdir)
    throwForNode(locNode, new Error(
        'Required "log_dir" directive was not found'));

  var dirIndex = !!locNode.getValues('directory_index').enabled;
  // TODO: Filter on locPath
  var realRouter = new DirectoryRouter(sitedirPath, runas, dirIndex, rootPath,
      logdir, settings);
  if (locPath !== rootPath) {
    return new router.PrefixFilterRouter(realRouter, locPath);
  } else {
    return realRouter;
  }
}

function createAppDir(locNode, node, settings) {
  if (locNode.depth !== (node.depth - 1)) {
    throwForNode(locNode, new Error('A location node may not inherit the app_dir directive.'));
  }

  var locPath = deriveLocationPath(locNode);
  var appdirPath = locNode.getValues('app_dir').path;

  var runas = locNode.getValues('run_as').users;
  if (!runas || runas.length == 0)
    throwForNode(locNode, new Error(
        'Required "run_as" directive not present or has no users.'));

  var logdir = locNode.getValues('log_dir').path;
  if (!logdir)
    throwForNode(locNode, new Error(
        'Required "log_dir" directive was not found'));

  assert(appdirPath);
  return new router.SingleAppRouter(
      appdirPath, runas, locPath, logdir, settings);
}

/**
 * @param userDirsMode A Boolean representing whether we should be operating as
 *   'user_apps' (which ignores the run_as directive), or 'user_dirs' (which 
 *   respects the run_as directive).
 **/
function createUserApps(locNode, node, settings, userDirsMode) {
  var locPath = deriveLocationPath(locNode);
  var rootPath = deriveLocationPath(node.parent);

  var userappsNode = locNode.getOne('user_apps');
  var userappsEnabled = node.values.length == 0 || node.values.enabled;
  if (!userappsEnabled) {
    throwForNode(node, new Error('"' + node.args[0] + '" can no longer be used with the user_apps directive. Please omit the user_apps directive instead.'));
  }

  // We initially didn't require that user_apps would have a run_as setting
  // associated with it. So to maintain backwards compatibility, we need to 
  // continue to maintain these different code paths, at least for the time 
  // being. For now, we'll pass the (optional) run_as parameter into the 
  // construction of the UserDirsRouter.
  var runas = null;
  if (userDirsMode)
    runas = locNode.getValues('run_as').users;

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

  var dirIndex = !!locNode.getValues('directory_index').enabled;

  var realRouter = new UserDirsRouter(rootPath, groups, settings, runas, 
    dirIndex);
  if (locPath !== rootPath) {
    return new router.PrefixFilterRouter(realRouter, locPath);
  } else {
    return realRouter;
  }
}

function createRedirect(locNode, node, settings) {
  var locPath = deriveLocationPath(locNode);
  var rootPath = deriveLocationPath(node.parent);

  var redirectArgs = node.values;
  var realRouter = new router.RedirectRouter(
      rootPath, redirectArgs.url, redirectArgs.statusCode, redirectArgs.exact);
  if (locPath !== rootPath) {
    return new router.PrefixFilterRouter(realRouter, locPath);
  } else {
    return realRouter;
  }
}

/**
 * Validates the location node, and returns the appropriate type of router
 * it represents.
 */
function createLocation(locNode) {
  // TODO: Include ancestor locations in path
  var path = locNode.values.path;

  var terminalLocation = !locNode.getOne('location', false);
  var node = locNode.getOne(/^site_dir|user_dirs|app_dir|user_apps|redirect$/);
  if (!node) {
    // No directives. Only allow this if child locations exist.
    if (terminalLocation)
      throwForNode(locNode, new Error('location directive must contain (or inherit) one of site_dir, user_apps, app_dir, or redirect'));
    else
      return null;
  }

  var settings = map.create();
  var gaid = locNode.getValues('google_analytics_id').gaid;
  if (gaid)
    settings.gaTrackingId = gaid;

  // Add the templateDir to the AppSpec, if we have one.
  var templateDir = locNode.getValues('template_dir').dir;
  if (templateDir){
    settings.templateDir = templateDir;
  }

  settings = configRouterUtil.parseApplication(settings, 
      locNode, true);

  switch (node.name) {
    case 'site_dir':
      return createSiteDir(locNode, node, settings);
    case 'app_dir':
      return createAppDir(locNode, node, settings);
    case 'user_apps':
      return createUserApps(locNode, node, settings);
    case 'user_dirs':
      return createUserApps(locNode, node, settings, true);
    case 'redirect':
      return createRedirect(locNode, node, settings);
    default:
      throwForNode(locNode, new Error('Node name ' + node.name + ' was not expected here'));
  }
}
