var fs = require('fs');
var path = require('path');
var posix = require('../../build/Release/posix');
var AppSpec = require('../worker/app-spec');

exports.DummyRouter = DummyRouter;
function DummyRouter(appDir, runAs) {
  this.appSpec = new AppSpec(appDir, runAs, '', null, {});
}

(function() {
  this.getAppSpec = function(req) {
    return this.appSpec;
  };
}).call(DummyRouter.prototype);


exports.AutouserRouter = AutouserRouter;
function AutouserRouter() {
}

(function() {
  this.getAppSpec = function(req) {
    var m = /^\/([^\/]+)\/([^\/]+)\//.exec(req.url);
    if (!m)
      return null;

    var prefix = m[0];
    var username = m[1];
    var appname = m[2];
    
    var pw = posix.getpwnam(username);
    if (!pw)
      return null;

    var dir = path.join(pw.home, 'ShinyApps', appname);
    var logDir = path.join(pw.home, 'ShinyApps', 'log');
    try {
      fs.mkdirSync(logDir, '755');
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
    return new AppSpec(dir, username, prefix, logDir, {});
  };
}).call(AutouserRouter.prototype);