/*
 * test/integration/lifecycle.js
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

// Startup, config reload (what SIGHUP does), and shutdown. These are the paths
// lib/server-init.js and lib/server/server.js own, and the ones a test process
// exercises hundreds of times -- so a leak here shows up as flakiness
// everywhere else.

var assert = require('assert');
var fs = require('fs');
var net = require('net');
var testServer = require('../support/server');
var testConfig = require('../support/config');

describe('server lifecycle', function() {
  var server;

  afterEach(function() {
    var s = server;
    server = null;
    return s ? s.stop_p() : null;
  });

  it('reports the ephemeral port it actually bound', function() {
    return testServer.start_p(testConfig.siteDirConfig(), {
      files: {'site/index.html': 'hi'}
    })
    .then(function(s) {
      server = s;
      var addresses = s.handle.addresses();
      assert.strictEqual(addresses.length, 1);
      assert.strictEqual(addresses[0].port, s.port);
      assert.notStrictEqual(addresses[0].port, 0,
        'addresses() should report the assigned port, not the configured 0');
    });
  });

  it('rejects when the config file does not exist', function() {
    return testServer.start_p(testConfig.siteDirConfig(), {files: {}})
    .then(function(s) {
      server = s;
      // Point a fresh startup at a path that isn't there.
      var server_init = require('../../lib/server-init');
      return server_init.createServer_p('/nonexistent/shiny-server.conf')
      .then(
        function() { throw new Error('should have rejected'); },
        function(err) { return err; }
      );
    })
    .then(function(err) {
      assert.strictEqual(err.code, 'ENOENT');
    });
  });

  it('rejects an invalid config rather than starting', function() {
    return testServer.start_p('run_as $USER;\nserver { listen 0 127.0.0.1; nonsense; }', {})
    .then(
      function(s) { server = s; throw new Error('should have rejected'); },
      function(err) {
        assert.ok(/Unknown directive "nonsense"/.test(err.message),
          'unexpected error: ' + err.message);
      }
    );
  });

  it('reports a bind failure without rejecting', function() {
    // Historically a listener that couldn't bind was logged and forwarded as an
    // 'error' event, and startup carried on. That is preserved; the errors are
    // just also visible on the handle now.
    var blocker = net.createServer();
    return new Promise(function(resolve) {
      blocker.listen(0, '127.0.0.1', function() { resolve(blocker.address().port); });
    })
    .then(function(port) {
      return testServer.start_p(
        testConfig.siteDirConfig({listen: port + ' 127.0.0.1'}), {files: {}})
      .then(
        function(s) { s.stop_p(); throw new Error('expected no usable address'); },
        function(err) { return err; }
      );
    })
    .then(function(err) {
      // start_p turns "no addresses bound" into this error; the point is that
      // createServer_p itself resolved rather than rejecting.
      assert.ok(/did not bind any address/.test(err.message),
        'unexpected error: ' + err.message);
      assert.ok(/EADDRINUSE/.test(err.message),
        'the bind error should be reported: ' + err.message);
    })
    .then(function() {
      return new Promise(function(resolve) { blocker.close(resolve); });
    });
  });

  describe('reload', function() {
    it('picks up a changed config without restarting', function() {
      var port;
      return testServer.start_p(testConfig.siteDirConfig(), {
        files: {'site/index.html': 'before'}
      })
      .then(function(s) {
        server = s;
        port = s.port;
        return s.get_p('/index.html');
      })
      .then(function(r) {
        assert.strictEqual(r.body, 'before');
        // Swap the served content and the config's directory_index setting,
        // then reload the way SIGHUP does.
        fs.writeFileSync(server.config.dir + '/site/index.html', 'after');
        return server.handle.reload_p();
      })
      .then(function() {
        // Same port: setAddresses only opens/closes the delta, and the address
        // didn't change.
        assert.strictEqual(server.handle.addresses()[0].port, port);
        return server.get_p('/index.html');
      })
      .then(function(r) {
        assert.strictEqual(r.body, 'after');
      });
    });

    it('resolves promptly even while a connection is open on the old config', function() {
      // setAddresses deliberately does not wait for obsolete listeners to
      // finish closing, because server.close() blocks on established
      // connections. If it did wait, a reload behind a long-lived session would
      // stall -- and loadConfig_p is serialized, so the *next* reload with it.
      return testServer.start_p(testConfig.siteDirConfig(), {
        files: {'site/index.html': 'hi'}
      })
      .then(function(s) {
        server = s;
        return new Promise(function(resolve, reject) {
          var sock = net.connect(s.port, '127.0.0.1', function() { resolve(sock); });
          sock.on('error', reject);
        });
      })
      .then(function(sock) {
        var started = Date.now();
        return server.handle.reload_p().then(function() {
          var elapsed = Date.now() - started;
          sock.destroy();
          assert.ok(elapsed < 5000,
            'reload took ' + elapsed + 'ms with a socket open; it should not ' +
            'wait for connections to drain');
        });
      });
    });

    it('survives repeated reloads', function() {
      return testServer.start_p(testConfig.siteDirConfig(), {
        files: {'site/index.html': 'hi'}
      })
      .then(function(s) {
        server = s;
        return s.handle.reload_p()
          .then(function() { return s.handle.reload_p(); })
          .then(function() { return s.handle.reload_p(); });
      })
      .then(function() {
        assert.strictEqual(server.handle.addresses().length, 1,
          'repeated reloads should not accumulate or lose listeners');
        return server.get_p('/index.html');
      })
      .then(function(r) {
        assert.strictEqual(r.status, 200);
      });
    });
  });

  describe('shutdown', function() {
    it('is idempotent', function() {
      return testServer.start_p(testConfig.siteDirConfig(), {
        files: {'site/index.html': 'hi'}
      })
      .then(function(s) {
        return s.handle.shutdown_p()
          .then(function() { return s.handle.shutdown_p(); })
          .then(function() {
            assert.deepStrictEqual(s.handle.addresses(), []);
            s.config.cleanup();
            return s.worker ? s.worker.uninstall_p() : null;
          });
      });
    });
  });
});
