var fs = require('fs');
var path = require('path');
var send = require('send');
var url = require('url');
var util = require('util');
var Q = require('q');
var regexp_quote = require('regexp-quote');
var _ = require('underscore');
var qutil = require('../core/qutil');
var AppSpec = require('../worker/app-spec');

module.exports = DirectoryRouter;
function DirectoryRouter(root, runas, prefix, logdir, settings) {
  prefix = prefix.replace(/\/$/m, ''); // strip trailing slash, if any
  this.$root = root;
  this.$runas = runas;
  this.$logdir = logdir;
  this.$settings = settings;

  this.$rePath = new RegExp('^' + regexp_quote(prefix) + '(?=/|$)');
}

(function() {
  this.getAppSpec_p = function(req, res) {
    var self = this;

    var reqUrl = url.parse(req.url);
    var pathname = reqUrl.pathname;
    var m = this.$rePath.exec(pathname);
    if (!m)
      return Q.resolve(null);
    var prefix = m[0];
    var suffix = pathname.substring(prefix.length);

    if (/\.shiny(\/|$)/.test(unescape(pathname))) {
      res.writeHead(403, {'Content-Type': 'text/html'});
      res.end('<h1>Forbidden</h1>');
      return Q.resolve(true);
    }

    return this.$findShinyDir_p(suffix)
    .fail(function(err) {
      return null;
    })
    .then(function(subpath) {
      if (subpath) {
        return new AppSpec(path.join(self.$root, subpath.path + '.shiny'),
          self.$runas, prefix + subpath.rawPath, self.$logdir, self.$settings);
      } else {
        return self.$staticServe_p(req, res, reqUrl, suffix);
      }
    });
  };

  this.$staticServe_p = function(req, res, reqUrl, suffix) {
    var deferred = Q.defer();

    function onError(err) {
      if (err.status == 404)
        deferred.resolve(null);
      else
        deferred.reject(err);
    }

    function onDirectory() {
      res.writeHead(301, {
        'Location': reqUrl.pathname + '/' + (reqUrl.search || '')
      });
      res.end();
      deferred.resolve(true);
    }

    function onStream() {
      deferred.resolve(true);
    }

    send(req, suffix)
      .root(this.$root)
      .on('error', onError)
      .on('directory', onDirectory)
      .on('stream', onStream)
      .pipe(res);

    return deferred.promise;
  };

  this.$findShinyDir_p = function(pathname) {
    var self = this;

    if (pathname.length <= 1)
      return Q.resolve(null);
    if (pathname.charAt(0) != '/')
      return Q.resolve(null);

    var candidates = extractUnescapedDirs(pathname);
    if (!candidates || candidates.length == 0)
      return Q.resolve(null);

    function testDir_p(dirPath) {
      if (!fs.existsSync(dirPath))
        return Q.resolve({exists: false, isDirectory: false});
        
      return Q.nfcall(fs.stat, dirPath)
      .then(function(stats) {
        return {exists: true, isDirectory: stats.isDirectory()};
      });
    }

    return qutil.forEachPromise_p(
      candidates,
      function(subpath) {
        return testDir_p(path.join(self.$root, subpath.path + '.shiny'))
        .then(function(testDirResult) {
          if (!testDirResult.exists)
            return false; // terminate loop and return false
          else if (!testDirResult.isDirectory)
            return null; // continue loop
          else
            return subpath; // terminate loop and return subpath
        });
      },
      function(result) {
        return result !== null;
      },
      null
    )
    .fail(function(err) {
      logger.debug(err.message);
      return null;
    });
  };
}).call(DirectoryRouter.prototype);

/**
 * Convert the given /-delimited path into a list of dirs and its original
 * representation in the escaped path. For example:
 *
 * Input: /foo/bar//./this%20that/blah
 * Output: [
 *   { path: 'foo', rawPath: '/foo' },
 *   { path: 'foo/bar', rawPath: '/foo/bar' },
 *   { path: 'foo/bar/this that', rawPath: '/foo/bar//./this%20that' }
 *
 * If .. or escaped / is detected in any of the path elements then null is
 * returned, indicating that the given path could not be safely mapped to
 * a path.
 */
function extractUnescapedDirs(p) {
  var re = /\//g;
  var m;

  var pathAccum = '';
  var pathElements = [];
  var lastpos = 0;
  var element;
  while (m = re.exec(p)) {
    element = unescape(p.substring(lastpos, m.index));
    lastpos = m.index + 1;

    // empty? ignore.
    if (!element) {
      continue;
    }
    // only spaces? bail.
    if (/^\s*$/.test(element))
      return null;
    // ..? bail.
    if (element === '..')
      return null;
    if (element === '.')
      continue;
    // contains \ or / (possible if the / was escaped)? bail.
    if (/[\/\\]/.test(element))
      return null;

    if (pathAccum)
      pathAccum += path.sep;
    pathAccum += element;

    pathElements.push({path: pathAccum, rawPath: p.substring(0, m.index)});
  }
  return pathElements;
}
