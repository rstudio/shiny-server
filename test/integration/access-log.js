/*
 * test/integration/access-log.js
 *
 * Copyright (C) 2026 by Posit Software, PBC
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

// The access log is not middleware. It is a second 'request' listener on the
// Server facade, registered after the one that calls app.handle
// (lib/server-init.js). That ordering is load-bearing: by the time morgan runs,
// req.url has already been rewritten -- by the __assets__ handler, or by the
// proxy stripping the app prefix -- so the only way to log what the client
// actually asked for is req.originalUrl.

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var testServer = require('../support/server');
var testConfig = require('../support/config');

describe('access log', function() {
  var server;
  var logPath;

  beforeEach(function() {
    return testServer.start_p(testConfig.siteDirConfig({
      preamble: 'access_log $DIR/access.log combined;'
    }), {
      files: {
        'site/index.html': '<h1>root</h1>',
        'site/myapp/server.R': '# not actually run\n'
      }
    })
    .then(function(s) {
      server = s;
      logPath = path.join(s.config.dir, 'access.log');
    });
  });

  afterEach(function() {
    var s = server;
    server = null;
    return s ? s.stop_p() : null;
  });

  it('logs the original URL of a proxied app request, not the rewritten one', function() {
    return server.get_p('/myapp/sub/page.html?x=1')
    .then(function() {
      return readLog_p(logPath);
    })
    .then(function(lines) {
      var line = lines.find(function(l) { return /myapp/.test(l); });
      assert.ok(line, 'no line mentioning myapp in:\n' + lines.join('\n'));
      assert.ok(line.indexOf('GET /myapp/sub/page.html?x=1 HTTP') >= 0,
        'expected the pre-rewrite URL, got: ' + line);
    });
  });

  it('logs the original URL of an asset request, not the rewritten one', function() {
    return server.get_p('/__assets__/sockjs.min.js')
    .then(function() {
      return readLog_p(logPath);
    })
    .then(function(lines) {
      var line = lines.find(function(l) { return /sockjs\.min\.js/.test(l); });
      assert.ok(line, 'no line mentioning sockjs.min.js in:\n' + lines.join('\n'));
      // The asset middleware rewrites req.url to a leading-slash-less
      // "sockjs.min.js" before handing it to express.static.
      assert.ok(line.indexOf('GET /__assets__/sockjs.min.js HTTP') >= 0,
        'expected the pre-rewrite URL, got: ' + line);
    });
  });

  it('logs the response status', function() {
    return server.get_p('/no-such-page')
    .then(function() {
      return readLog_p(logPath);
    })
    .then(function(lines) {
      var line = lines.find(function(l) { return /no-such-page/.test(l); });
      assert.ok(line, 'no line for the 404 in:\n' + lines.join('\n'));
      assert.ok(/ 404 /.test(line), 'expected a 404 in: ' + line);
    });
  });

  it('logs requests that never reach the Express stack', function() {
    // /ping is answered by the ping router inside the app, so it does go
    // through app.handle -- but this pins that the logger sees every request
    // unconditionally, rather than only the ones some middleware passes on.
    return server.get_p('/ping')
    .then(function() {
      return readLog_p(logPath);
    })
    .then(function(lines) {
      assert.ok(lines.some(function(l) { return /GET \/ping HTTP/.test(l); }),
        'no line for /ping in:\n' + lines.join('\n'));
    });
  });
});

/**
 * morgan writes on the response's 'finished' event through a stream, so the
 * line can land slightly after the client has the body.
 */
function readLog_p(logPath) {
  var deadline = Date.now() + 2000;
  return new Promise(function(resolve, reject) {
    (function poll() {
      var text = '';
      try {
        text = fs.readFileSync(logPath, 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') return reject(err);
      }
      var lines = text.split('\n').filter(function(l) { return l.length > 0; });
      if (lines.length > 0) return resolve(lines);
      if (Date.now() > deadline)
        return reject(new Error('Timed out waiting for the access log to be written'));
      setTimeout(poll, 10);
    })();
  });
}
