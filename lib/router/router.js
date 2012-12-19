var fs = require('fs');
var path = require('path');
var url = require('url');
var _ = require('underscore');
var posix = require('../../build/Release/posix');
var AppSpec = require('../worker/app-spec');

var regexp_quote = require('regexp-quote');

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
  this.getAppSpec = function(req, res) {
    return this.appSpec;
  };
}).call(DummyRouter.prototype);


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
      return {getAppSpec: router};
    else
      return router;
  }));
}

(function() {
  this.getAppSpec = function(req, res) {
    var args = arguments;
    var result = null;
    _.every(this.$routers, function(router) {
      result = router.getAppSpec.apply(router, args);
      return !result; // If result is truthy, break by returning false
    });
    return result;
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


exports.AutouserRouter = AutouserRouter;
function AutouserRouter(prefix, settings) {
  prefix = prefix.replace(/\/$/m, ''); // strip trailing slash, if any
  this.$prefix = prefix;
  this.$settings = settings || {};
  this.$rePath = new RegExp(
      '^' + regexp_quote(prefix) + '/([^/]+)/([^/]+)(/)?');
}

(function() {
  this.getAppSpec = function(req, res) {
    var reqUrl = url.parse(req.url);
    var m = this.$rePath.exec(reqUrl.pathname);
    if (!m)
      return null;

    var prefix = m[0];
    var username = m[1];
    var appname = m[2];
    if (!m[3]) {
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
    
    var pw = posix.getpwnam(username);
    if (!pw)
      return null;

    var dir = path.join(pw.home, 'ShinyApps', appname);
    var logDir = path.join(pw.home, 'ShinyApps', 'log');
    try {
      fs.mkdirSync(logDir, '755');
      fs.chownSync(logDir, pw.uid, pw.gid);
    } catch (ex) {
      try {
        var stat = fs.statSync(logDir);
        if (!stat.isDirectory()) {
          logger.error('Log directory existed, was a file');
          logDir = null;
        }
      } catch (ex2) {
        logger.error('Log directory creation failed: ' + ex2.message);
        logDir = null;
      }
    }
    return new AppSpec(dir, username, prefix, logDir, _.clone(this.$settings));
  };
}).call(AutouserRouter.prototype);


exports.SingleAppRouter = SingleAppRouter;
function SingleAppRouter(appdir, runas, prefix, logDir) {
  prefix = prefix.replace(/\/$/m, ''); // strip trailing slash, if any
  this.$rePath = new RegExp('^' + regexp_quote(prefix) + '(?:(/)|$)');
  this.$appSpec = new AppSpec(appdir, runas, prefix + '/', logDir, {});
}

(function() {
  this.getAppSpec = function(req, res) {
    var reqUrl = url.parse(req.url);
    var m = this.$rePath.exec(reqUrl.pathname);
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

    return this.$appSpec;
  }
}).call(SingleAppRouter.prototype);
