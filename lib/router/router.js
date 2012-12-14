var fs = require('fs');
var path = require('path');
var url = require('url');
var _ = require('underscore');
var posix = require('../../build/Release/posix');
var AppSpec = require('../worker/app-spec');

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


exports.AutouserRouter = AutouserRouter;
function AutouserRouter(settings) {
  this.$settings = settings || {};
}

(function() {
  this.getAppSpec = function(req, res) {
    var reqUrl = url.parse(req.url);
    var m = /^\/([^\/]+)\/([^\/]+)(\/)?/.exec(reqUrl.pathname);
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
      }
      else {
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
      }
      catch (ex2) {
        logger.error('Log directory creation failed: ' + ex2.message);
        logDir = null;
      }
    }
    return new AppSpec(dir, username, prefix, logDir, _.clone(this.$settings));
  };
}).call(AutouserRouter.prototype);