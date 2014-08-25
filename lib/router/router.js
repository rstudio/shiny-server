/*
 * router.js
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
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var url = require('url');
var util = require('util');
var Q = require('q');
var _ = require('underscore');
var fsutil = require('../core/fsutil');
var qutil = require('../core/qutil');
var posix = require('../../build/Release/posix');
var appConfig = require('../config/app-config');
var configRouterUtil = require('../router/config-router-util');
var AppSpec = require('../worker/app-spec');
var regexp_quote = require('../core/re-quote');
var render = require('../core/render');

exports.NullRouter = NullRouter;
function NullRouter() {
}
(function() {
  this.getAppSpec_p = function(req, res) {
    return Q.resolve(null);
  };
}).call(NullRouter.prototype);

exports.DummyRouter = DummyRouter;
function DummyRouter(appDir, runAs) {
  this.appSpec = new AppSpec(appDir, runAs, '', null, {});
}

(function() {
  /**
   * Possible input values:
   * - In the case of normal HTTP request, req is a ServerRequest and res is a
   *   ServerResponse
   * - In the case of a SockJS request, req is a SockJS connection object and
   *   res is undefined
   *
   * Possible return values:
   * - An AppSpec object means to launch/reuse the specified app and proxy the
   *   request to it
   * - true means we already fully responded to the request, no other action is
   *   necessary (such as performing a redirect, for example)
   * - Falsy values means this router doesn't know how to handle this
   *   particular request
   */
  this.getAppSpec_p = function(req, res) {
    return Q.resolve(this.appSpec);
  };
}).call(DummyRouter.prototype);


exports.IndirectRouter = IndirectRouter;
/**
 * A router that wraps another router, where the latter can be replaced at any
 * time.
 */
function IndirectRouter(router) {
  this.$router = router;
}
(function() {
  this.getAppSpec_p = function(req, res) {
    return this.$router.getAppSpec_p.apply(this.$router, arguments);
  };
  this.setRouter = function(router) {
    this.$router = router;
  };
}).call(IndirectRouter.prototype);


// Router that annotates the AppSpec with $APPDIR/restart.txt timestamp,
// if the file exists. This makes it possible for app developers and
// admins to use "touch restart.txt" to force an app to start a fresh
// instance on subsequent loads.
exports.RestartRouter = RestartRouter;
function RestartRouter(router) {
  this.$router = router;
}
(function() {
  this.getAppSpec_p = function(req, res) {
    return this.$router.getAppSpec_p.apply(this.$router, arguments)
    .then(function(appSpec) {
      if (appSpec && typeof(appSpec) === 'object') {
        var restartPath = path.join(appSpec.appDir, 'restart.txt');
        return fsutil.safeStat_p(restartPath)
        .then(
          function(stat) {
            if (stat)
              appSpec.settings.restart = stat.mtime.getTime();
            return appSpec;
          },
          function(err) {
            logger.error('Error checking restart.txt: ' + err.message);
            return appSpec;
          }
        );
      } else {
        return appSpec;
      }
    });
  };
}).call(RestartRouter.prototype);


exports.getFirstAppSpec_p = getFirstAppSpec_p;
function getFirstAppSpec_p(routers, req, res) {
  return qutil.forEachPromise_p(
    routers,
    function(router) {
      return router.getAppSpec_p(req, res);
    },
    function(appSpec) {
      return !!appSpec;
    },
    null
  );
}


/**
 * A router that takes a router and a prefix. For each request, if the
 * request matches the prefix, then the request is delegated to the
 * underlying router; otherwise, null is returned.
 */
exports.PrefixFilterRouter = PrefixFilterRouter;
function PrefixFilterRouter(router, prefix) {
  this.$router = router;

  prefix = prefix.replace(/\/$/m, ''); // strip trailing slash, if any
  this.$rePath = new RegExp('^' + regexp_quote(prefix) + '(?=/|$)');
  this.$_prefix = prefix;
}

(function() {
  this.getAppSpec_p = function(req, res) {
    var reqUrl = url.parse(req.url);
    var pathname = reqUrl.pathname;
    var m = this.$rePath.exec(pathname);
    if (!m)
      return Q.resolve(null);
    else
      return this.$router.getAppSpec_p(req, res);
  };
}).call(PrefixFilterRouter.prototype);


exports.CompositeRouter = CompositeRouter;
/**
 * A router that takes a list of routers, and for each request, tries each
 * router in order until one of them returns a truthy value.
 *
 * @param {Router[]} routers - Array of routers or getAppSpec functions.
 *   You can also include falsy values, which will be ignored.
 */
function CompositeRouter(routers) {
  this.$routers = _.compact(_.map(routers, function(router) {
    if (typeof router === 'function')
      return {
        getAppSpec_p: function(req, res) {
          assert(req);
          return Q.resolve(router.apply(null, arguments));
        }
      };
    else
      return router;
  }));
}

(function() {
  this.getAppSpec_p = function(req, res) {
    return getFirstAppSpec_p(this.$routers, req, res);
  };
}).call(CompositeRouter.prototype);

/**
 * Combines any number of routers into a single router that will try them all
 * in order until one of them returns a truthy value.
 *
 * @param {...Router} routers - Any number of routers or getAppSpec functions.
 *   You can also pass falsy values, which will be ignored.
 */
exports.join = function() {
  return new CompositeRouter(arguments);
};

exports.SingleAppRouter = SingleAppRouter;
function SingleAppRouter(appdir, runas, prefix, logDir, settings) {
  prefix = prefix.replace(/\/$/m, ''); // strip trailing slash, if any
  settings = settings || {};
  this.$rePath = new RegExp('^' + regexp_quote(prefix) + '(?:(/)|$)');
  
  this.$appdir = appdir;
  this.$runas = runas;
  this.$prefix = prefix + '/';
  this.$logDir = logDir;
  this.$settings = settings;

  var self = this;
}

(function() {
  this.getAppSpec_p = function(req, res) {
    
    var self = this;

    // Creates a /shallow/ copy of the settings object. So we can independently
    // mutate top-level properties (but not nested objects) without affecting 
    // the class variable.
    var settings = _.clone(self.$settings);

    // Create a local appSpec that we can modify.
    var appSpec = new AppSpec(self.$appdir, self.$runas, self.$prefix, 
      self.$logDir, settings);

    return Q.nfcall(fs.readdir, appSpec.appDir)
    .then(function(files){ 
      var app = _.find(files, function(entry) {
        return /^server\.r$/i.test(entry);
      });

      var singleApp = _.find(files, function(entry) {
        return /^app\.r$/i.test(entry);
      });
      var rmd = _.find(files, function(entry) {
        return /\.rmd$/i.test(entry);
      });
      var indexRmd = _.find(files, function(entry) {
        if (/^index\.rmd$/i.test(entry)){
          return entry;
        }
        return false;
      });
      var indexHtm = _.find(files, function(entry) {
        if (/index\.htm(l)?$/i.test(entry)){
          return entry;
        }
        return false;
      });

      var indexType  = indexRmd ? 'rmd' : indexHtm ? 'html' : null;
      var indexPath = indexRmd || indexHtm;

      if (app || singleApp){
        appSpec.settings.mode = 'shiny';
      } else if(rmd){
        appSpec.settings.mode = 'rmd';
        if (indexType === 'html' && self.$prefix === req.url){
          logger.debug("Serving index.html in lieu of index.Rmd.");
          // This implies that we did not have an index.Rmd (in which case
          // we would just run the app normally), but that we DO have an 
          // index.html file. We want to make an exception to our general flow
          // and, if the base URL is requested, serve this index.html file as
          // rmarkdown would just return a 404.
          Q.nfcall(fs.readFile, path.join(appSpec.appDir, indexPath))
          .then(function(content){
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content, 'utf-8');
          }, function(err){
            logger.warn("Attempting to serve an index.html file for an Rmd directory, but unable to read file: " + 
              path.join(appSpec.appDir, indexPath));
            render.sendPage(res, 500, 'Error Reading Index', {
              template: 'error-500',
              templateDir: appSpec.settings.templateDir
            });
          })
          .done();
          return true;
        }
      } else{
        // No app found.
      }

      var reqUrl = url.parse(req.url);
      var m = self.$rePath.exec(reqUrl.pathname);
      if (!m)
        return null;

      if (!m[1]) {
        if (res) {
          res.writeHead(301, {
            'Location': reqUrl.pathname + '/' + (reqUrl.search || '')
          });
          res.end();
          return true;
        } else {
          // SockJS case, this is not expected
          return null;
        }
      }
      return appSpec;
    });
  }
}).call(SingleAppRouter.prototype);


exports.RedirectRouter = RedirectRouter;
function RedirectRouter(prefix, url, statusCode, exact) {
  var prefix = prefix.replace(/\/$/m, '');
  if (exact)
    this.$rePath = new RegExp('^' + regexp_quote(prefix) + '/?$');
  else
    this.$rePath = new RegExp('^' + regexp_quote(prefix) + '(?:/|$)');
  this.$url = url;
  this.$statusCode = statusCode;
}
(function() {
  this.getAppSpec_p = qutil.wrap(function(req, res) {
    if (!res)
      return null;

    var reqUrl = url.parse(req.url);
    if (!this.$rePath.test(reqUrl.pathname))
      return null;

    res.writeHead(this.$statusCode, {
      Location: this.$url
    });
    res.end();
    return true;
  });
}).call(RedirectRouter.prototype);
