/*
 * directory-router.js
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
var fs = require('fs');
var path = require('path');
var send = require('send');
var url = require('url');
var util = require('util');
var Q = require('q');
var regexp_quote = require('regexp-quote');
var _ = require('underscore');
var qutil = require('../core/qutil');
var render = require('../core/render');
var AppSpec = require('../worker/app-spec');

send.mime.define({'text/R': ['r']});

module.exports = DirectoryRouter;
/**
 * @param {String} root The root directory from which to serve content/apps
 * @param {String} runas The username of the user we should impersonate when
 *   serving up apps
 * @param {Boolean} dirIndex True if directory index should be shown when
 *   index.html is not found
 * @param {String} logdir Directory in which to create log files for apps
 * @param {Object} settings Settings to pass through to AppSpec
 */
function DirectoryRouter(root, runas, dirIndex, prefix, logdir, settings) {
  prefix = prefix.replace(/\/$/m, ''); // strip trailing slash, if any
  this.$root = root;
  this.$runas = runas;
  this.$dirIndex = dirIndex;
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

    // Disallow hidden path elements, ".", and ".."
    if (/\/\./.test(unescape(pathname))) {
      res.writeHead(403, {'Content-Type': 'text/html'});
      res.end('<h1>Forbidden</h1>');
      return Q.resolve(true);
    }

    return this.$findShinyDir_p(suffix)
    .fail(function(err) {
      logger.error('Error finding Shiny dir: ' + err.message);
      return null;
    })
    .then(function(subpath) {
      if (subpath) {
        // Shiny directory was found
        if (subpath.rawPath == suffix) {
          // Trailing slash was missing; redirect to add it
          res.writeHead(301, {
            'Location': reqUrl.pathname + '/' + (reqUrl.search || '')
          });
          res.end();
          return false;
        }
        else {
          // Valid request in an application path
          return new AppSpec(path.join(self.$root, subpath.path),
            self.$runas, prefix + subpath.rawPath, self.$logdir,
            self.$settings);
        }
      } else {
        // Not in Shiny app directory; serve statically
        return self.$staticServe_p(req, res, reqUrl, suffix);
      }
    });
  };

  this.$staticServe_p = function(req, res, reqUrl, suffix) {
    var self = this;
    var deferred = Q.defer();

    function onError(err) {
      if (err.status == 404)
        deferred.resolve(null);
      else
        deferred.reject(err);
    }

    // Called when the URL requested is a directory
    function onDirectory() {
      var this_SendStream = this;
      if (!/\/$/.test(reqUrl.pathname)) {
        // No trailing slash? Redirect to add one
        res.writeHead(301, {
          'Location': reqUrl.pathname + '/' + (reqUrl.search || '')
        });
        res.end();
        deferred.resolve(true);
        return;
      }

      var indexPath = path.normalize(path.join(
        self.$root, unescape(this.path), 'index.html'));

      fs.exists(indexPath, function(exists) {
        if (exists) {
          // index.html exists, just serve that. This is the same as
          // the below call except without onDirectory and without
          // .index(false)
          send(req, suffix)
            .root(self.$root)
            .on('error', onError)
            .on('stream', onStream)
            .pipe(res);
        } else {
          // Either serve up 404, or the directory auto-index
          if (!self.$dirIndex) {
            deferred.resolve(null);
          } else {
            deferred.resolve(
              self.$autoindex_p(req, res, this_SendStream.path)
            );
          }
        }
      });
    }

    function onStream() {
      deferred.resolve(true);
    }

    send(req, suffix)
      .root(this.$root)
      .on('error', onError)
      .on('directory', onDirectory)
      .on('stream', onStream)
      .index(false)
      .pipe(res);

    return deferred.promise;
  };

  this.$autoindex_p = function(req, res, apath) {
    var unescapedPath = unescape(apath);
    var dirpath = path.normalize(path.join(this.$root, unescapedPath));
    return Q.nfcall(fs.readdir, dirpath)
    .then(function(files) {
      files = _.reject(files, function(file) {
        // reject hidden files
        return /^\./.test(file);
      });
      files.sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
      });
      return qutil.map_p(files, function(file) {
        return Q.nfcall(fs.stat, path.join(dirpath, file))
        .then(function(stat) {
          return {name: file, stat: stat};
        });
      });
    })
    .then(function(fileInfos) {
      var files = [];
      var dirs = [];
      _.each(fileInfos, function(file) {
        if (file.stat.isDirectory()) {
          dirs.push(file.name);
        } else {
          files.push(file.name);
        }
      });
      function linkifyAll(names) {
        return _.map(names, function(name) {
          return {
            name: name,
            url: escape(name)
          };
        });
      }
      files = linkifyAll(files);
      dirs = linkifyAll(dirs);

      render.sendPage(res, 200, 'Index of ' + unescapedPath, {
        template: 'directoryIndex',
        vars: {
          files: files,
          dirs: dirs,
        }
      });
    });
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

    // Returns { exists: true|false, isApp: true|false }
    function isAppDir_p(dirPath) {
      var deferred = Q.defer();
      fs.exists(dirPath, function(exists) {
        if (!exists)
          deferred.resolve({exists: false, isApp: false});
        else {
          deferred.resolve(
            Q.nfcall(fs.readdir, dirPath)
            .then(
              function(entries) {
                var found = _.find(entries, function(entry) {
                  return /^server\.r$/i.test(entry);
                });
                return {exists: true, isApp: !!found};
              },
              function(err) {
                logger.error('Error reading dir: ' + err.message);
                return {exists: true, isApp: false};
              }
            )
          );
        }
      });

      return deferred.promise;
    }

    return qutil.forEachPromise_p(
      candidates,
      function(subpath) {
        return isAppDir_p(path.join(self.$root, subpath.path))
        .then(function(testDirResult) {
          if (!testDirResult.exists)
            return false; // terminate loop and return false
          else if (!testDirResult.isApp)
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
  var re = /\/|$/g;
  var m;

  var pathAccum = '';
  var pathElements = [];
  var lastpos = 0;
  var element;
  while (m = re.exec(p)) {
    // This can happen if p ends with /, since we match on $
    if (lastpos > p.length)
      break;
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
