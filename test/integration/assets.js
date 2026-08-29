/*
 * test/integration/assets.js
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

// Characterization of the __assets__ middleware (lib/server-init.js), which is
// the most Express-version-sensitive thing in the codebase: it rewrites req.url
// out from under express.static, in ways express.static was never meant to see.
//
// These assert status and body directly rather than checking for fall-through,
// because there is no fall-through. filterByRegex (lib/core/connect-util.js)
// hands a matching request to the asset handler, which passes next404 to
// express.static, so a miss renders a 404 page instead of calling next(). A
// request matching __assets__ never reaches ShinyProxy.

var assert = require('assert');
var testServer = require('../support/server');
var testConfig = require('../support/config');

describe('__assets__', function() {
  var server;

  before(function() {
    return testServer.start_p(testConfig.siteDirConfig(), {
      files: {
        'site/index.html': '<h1>site root</h1>',
        'site/myapp/server.R': '# not actually run\n'
      }
    })
    .then(function(s) { server = s; });
  });

  after(function() {
    return server ? server.stop_p() : null;
  });

  it('serves a real asset', function() {
    return server.get_p('/__assets__/sockjs.min.js').then(function(r) {
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.length > 0);
      assert.ok(/javascript/.test(r.headers.get('content-type')),
        'unexpected content-type: ' + r.headers.get('content-type'));
    });
  });

  it('serves a source map alongside its script', function() {
    return server.get_p('/__assets__/sockjs.min.js.map').then(function(r) {
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.length > 0);
    });
  });

  it('serves the shiny-server-client bundle', function() {
    return server.get_p('/__assets__/shiny-server-client.min.js').then(function(r) {
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.length > 0);
    });
  });

  it('404s a missing asset rather than falling through to the proxy', function() {
    return server.get_p('/__assets__/no-such-file.js').then(function(r) {
      assert.strictEqual(r.status, 404);
      assert.ok(/not found/i.test(r.body), 'expected the 404 template, got: ' +
        r.body.slice(0, 200));
    });
  });

  it('does not match the bare prefix (the regex requires a path after it)', function() {
    // filterByRegex tests /\b__assets__\/.+/, so "/__assets__/" alone does not
    // match and the request goes on to ShinyProxy, which 404s it as a
    // nonexistent app. This is the case that would rewrite req.url to '' and
    // leave parseurl's pathname null if the regex ever became laxer.
    return server.get_p('/__assets__/').then(function(r) {
      assert.strictEqual(r.status, 404);
    });
  });

  it('404s "?foo" instead of 500ing (the explicit /? rewrite)', function() {
    // The `.replace(/^\?/, '/?')` in the asset middleware exists precisely for
    // this input: without it, express.static sees a path of "?foo" and blows up
    // with a 500. Anything other than 404 here is a regression.
    return server.get_p('/__assets__/?foo').then(function(r) {
      assert.strictEqual(r.status, 404);
    });
  });

  it('refuses to traverse out of the assets directory', function() {
    return server.get_p('/__assets__/../../package.json').then(function(r) {
      assert.notStrictEqual(r.status, 200);
      assert.ok(!/"shiny-server"/.test(r.body),
        'package.json leaked through the asset handler');
    });
  });

  it('refuses percent-encoded traversal', function() {
    return server.get_p('/__assets__/%2e%2e%2f%2e%2e%2fpackage.json').then(function(r) {
      assert.notStrictEqual(r.status, 200);
      assert.ok(!/"shiny-server"/.test(r.body),
        'package.json leaked through the asset handler');
    });
  });

  it('matches a nested __assets__ path anywhere in the URL', function() {
    // The regex is unanchored (\b__assets__\/) and the rewrite is greedy
    // (/^.*\b__assets__\//), so an app-prefixed asset URL resolves to the same
    // file as the top-level one.
    return server.get_p('/myapp/__assets__/sockjs.min.js').then(function(r) {
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.length > 0);
    });
  });

  it('preserves originalUrl through the rewrite', function() {
    // The asset middleware sets req.originalUrl before mangling req.url. Morgan
    // and the access log depend on that; see the access-log test.
    return server.get_p('/myapp/__assets__/no-such-file.js').then(function(r) {
      assert.strictEqual(r.status, 404);
    });
  });
});
