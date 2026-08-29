/*
 * test/integration/harness.js
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

// Tests of the test harness itself. If these fail, nothing else in
// test/integration/ can be trusted.

var assert = require('assert');
var testServer = require('../support/server');
var testConfig = require('../support/config');

describe('integration harness', function() {
  var server;

  afterEach(function() {
    if (!server) return;
    var s = server;
    server = null;
    return s.stop_p();
  });

  it('boots on an ephemeral port and serves /ping', function() {
    return testServer.start_p(testConfig.siteDirConfig(), {
      files: {'site/index.html': '<h1>hi</h1>'}
    })
    .then(function(s) {
      server = s;
      assert.ok(s.port > 0, 'expected an ephemeral port, got ' + s.port);
      assert.deepStrictEqual(s.handle.bindErrors, []);
      return s.get_p('/ping');
    })
    .then(function(r) {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body, 'OK');
    });
  });

  it('shuts down completely, releasing the port', function() {
    var port;
    return testServer.start_p(testConfig.siteDirConfig(), {
      files: {'site/index.html': '<h1>hi</h1>'}
    })
    .then(function(s) {
      port = s.port;
      return s.stop_p();
    })
    .then(function() {
      // The port should be refused, not hang. This is the regression test for
      // the Server#$close leak: a listener dropped from $wildcards/$hosts
      // without being closed would still be accepting here.
      return fetch('http://127.0.0.1:' + port + '/ping').then(
        function(res) {
          throw new Error('expected connection refused, got HTTP ' + res.status);
        },
        function(err) { return err; }
      );
    })
    .then(function(err) {
      assert.ok(err, 'expected a connection error after shutdown');
    });
  });

  it('routes an app request through the proxy to a stand-in worker', function() {
    return testServer.start_p(testConfig.siteDirConfig(), {
      files: {'site/myapp/server.R': '# not actually run\n'}
    })
    .then(function(s) {
      server = s;
      return s.get_p('/myapp/');
    })
    .then(function(r) {
      assert.strictEqual(r.status, 200);
      var payload = JSON.parse(r.body);
      // The proxy strips the app prefix before forwarding.
      assert.strictEqual(payload.url, '/');
      // ...and stamps the per-worker shared secret on the way through.
      assert.ok(payload.sharedSecret, 'expected shiny-shared-secret to be set');
      assert.strictEqual(server.worker.workers.length, 1);
    });
  });

  it('passes a custom handler through to the stand-in worker', function() {
    return testServer.start_p(testConfig.siteDirConfig(), {
      files: {'site/myapp/server.R': '# not actually run\n'},
      worker: {
        handler: function(req, res) {
          res.writeHead(418, {'Content-Type': 'text/plain'});
          res.end('teapot');
        }
      }
    })
    .then(function(s) {
      server = s;
      return s.get_p('/myapp/');
    })
    .then(function(r) {
      assert.strictEqual(r.status, 418);
      assert.strictEqual(r.body, 'teapot');
    });
  });
});
