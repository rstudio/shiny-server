/*
 * test/integration/proxy.js
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

// Characterization of ShinyProxy.httpListener against a live server: the parts
// of the proxy path that depend on Express internals, plus the connection
// accounting that the res 'finish'/'close' listeners maintain.

var assert = require('assert');
var testServer = require('../support/server');
var testConfig = require('../support/config');

var APP_FILES = {
  'site/myapp/server.R': '# not actually run\n',
  'site/myapp/ui.R': '# not actually run\n',
  'site/index.html': '<h1>root</h1>'
};

describe('proxy', function() {

  describe('request forwarding', function() {
    var server;

    beforeEach(function() {
      return testServer.start_p(testConfig.siteDirConfig(), {files: APP_FILES})
      .then(function(s) { server = s; });
    });

    afterEach(function() {
      var s = server;
      server = null;
      return s ? s.stop_p() : null;
    });

    it('strips the app prefix before forwarding', function() {
      return server.get_p('/myapp/some/path').then(function(r) {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(JSON.parse(r.body).url, '/some/path');
      });
    });

    it('reads the query string via req._parsedUrl and forwards it intact', function() {
      // lib/proxy/http.js:117 does qs.parse(req._parsedUrl.query).w.
      // req._parsedUrl only exists as a side effect of parseurl caching inside
      // Express's router, so it is a private-API dependency that an Express
      // upgrade could remove. If it disappeared, that line would throw a
      // TypeError, which the surrounding .fail() turns into a 500 "Invalid
      // application configuration" -- so a 200 here is the real assertion.
      return server.get_p('/myapp/?foo=bar&baz=1').then(function(r) {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(JSON.parse(r.body).url, '/?foo=bar&baz=1');
      });
    });

    it('redirects to add the trailing slash, keeping the query string', function() {
      // An app directory requested without a trailing slash never reaches the
      // proxy: DirectoryRouter's onDirectory handler answers with a 301 first.
      return server.get_p('/myapp?foo=bar').then(function(r) {
        assert.strictEqual(r.status, 301);
        assert.strictEqual(r.headers.get('location'), '/myapp/?foo=bar');
      });
    });

    it('forwards the per-worker shared secret', function() {
      return server.get_p('/myapp/').then(function(r) {
        var secret = JSON.parse(r.body).sharedSecret;
        assert.ok(secret, 'no shiny-shared-secret header reached the app');
        assert.strictEqual(secret,
          server.worker.last().endpoint.getSharedSecret());
      });
    });

    it('forwards the request method', function() {
      return server.get_p('/myapp/', {method: 'POST', body: 'x'}).then(function(r) {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(JSON.parse(r.body).method, 'POST');
      });
    });

    it('404s a URL that matches no app', function() {
      return server.get_p('/nope/nothing/here').then(function(r) {
        assert.strictEqual(r.status, 404);
      });
    });

    it('relays the app status code and headers', function() {
      return server.get_p('/myapp/').then(function() {
        return server.stop_p();
      })
      .then(function() {
        return testServer.start_p(testConfig.siteDirConfig(), {
          files: APP_FILES,
          worker: {
            handler: function(req, res) {
              res.writeHead(404, {
                'Content-Type': 'text/plain',
                'X-App-Header': 'from-the-app'
              });
              res.end('app says no');
            }
          }
        });
      })
      .then(function(s) {
        server = s;
        return s.get_p('/myapp/');
      })
      .then(function(r) {
        assert.strictEqual(r.status, 404);
        assert.strictEqual(r.headers.get('x-app-header'), 'from-the-app');
        assert.strictEqual(r.body, 'app says no');
      });
    });
  });

  describe('X-Powered-By', function() {
    var server;

    before(function() {
      return testServer.start_p(testConfig.siteDirConfig(), {files: APP_FILES})
      .then(function(s) { server = s; });
    });

    after(function() {
      return server ? server.stop_p() : null;
    });

    // The first middleware sets this unconditionally, and app.disable
    // ('x-powered-by') stops Express from overwriting it with "Express".
    ['/ping', '/', '/myapp/', '/__assets__/sockjs.min.js', '/no-such-thing']
    .forEach(function(path) {
      it('is "Shiny Server" on ' + path, function() {
        return server.get_p(path).then(function(r) {
          assert.strictEqual(r.headers.get('x-powered-by'), 'Shiny Server');
        });
      });
    });
  });

  describe('worker connection accounting', function() {
    // ShinyProxy acquires an "http" reference before proxying and releases it
    // from a res 'finish'/'close' listener. compression wraps res.end, and Node
    // has changed finish/close ordering across versions, so this is worth
    // pinning down with compression both on and off.
    [true, false].forEach(function(compressionOn) {
      describe('with compression ' + (compressionOn ? 'on' : 'off'), function() {
        var server;

        beforeEach(function() {
          return testServer.start_p(testConfig.siteDirConfig({
            preamble: 'http_allow_compression ' + (compressionOn ? 'on' : 'off') + ';'
          }), {files: APP_FILES})
          .then(function(s) { server = s; });
        });

        afterEach(function() {
          var s = server;
          server = null;
          return s ? s.stop_p() : null;
        });

        it('returns httpConn to zero after the response completes', function() {
          return server.get_p('/myapp/some/asset.txt', {
            headers: {'Accept-Encoding': 'gzip'}
          })
          .then(function(r) {
            assert.strictEqual(r.status, 200);
            var entries = server.workerEntries();
            assert.strictEqual(entries.length, 1);
            // The cleanup runs on a res event, which can land a tick after the
            // client sees the body.
            return waitFor(function() {
              return entries[0].data.httpConn === 0;
            }, 'httpConn to return to 0, was ' + entries[0].data.httpConn);
          });
        });

        it('does not leak a pending reservation for a non-app-page request', function() {
          // isAppPage() is false for a URL with a file extension, so no
          // "pending" reference should ever be taken.
          return server.get_p('/myapp/some/asset.txt')
          .then(function() {
            var entries = server.workerEntries();
            return waitFor(function() {
              return entries[0].data.httpConn === 0;
            }, 'httpConn to return to 0')
            .then(function() {
              assert.strictEqual(entries[0].data.pendingConn, 0);
            });
          });
        });

        it('reserves a pending session for a successful app page', function() {
          // An app page request that succeeds is a strong hint that a SockJS
          // connection is about to arrive, so the proxy holds a "pending"
          // reference (released by a 45s timer if the session never shows).
          return server.get_p('/myapp/')
          .then(function(r) {
            assert.strictEqual(r.status, 200);
            var entries = server.workerEntries();
            return waitFor(function() {
              return entries[0].data.httpConn === 0;
            }, 'httpConn to return to 0')
            .then(function() {
              assert.strictEqual(entries[0].data.pendingConn, 1);
            });
          });
        });

        it('does not reserve a pending session when the app page fails', function() {
          var s;
          return server.stop_p()
          .then(function() {
            return testServer.start_p(testConfig.siteDirConfig({
              preamble: 'http_allow_compression ' + (compressionOn ? 'on' : 'off') + ';'
            }), {
              files: APP_FILES,
              worker: {
                handler: function(req, res) {
                  res.writeHead(500, {'Content-Type': 'text/plain'});
                  res.end('boom');
                }
              }
            });
          })
          .then(function(started) {
            server = s = started;
            return s.get_p('/myapp/');
          })
          .then(function(r) {
            assert.strictEqual(r.status, 500);
            var entries = s.workerEntries();
            return waitFor(function() {
              return entries[0].data.httpConn === 0;
            }, 'httpConn to return to 0')
            .then(function() {
              assert.strictEqual(entries[0].data.pendingConn, 0);
            });
          });
        });
      });
    });
  });

  describe('error surface', function() {
    var server;

    afterEach(function() {
      var s = server;
      server = null;
      return s ? s.stop_p() : null;
    });

    function start_p(workerOptions) {
      return testServer.start_p(testConfig.siteDirConfig(), {
        files: APP_FILES,
        worker: workerOptions
      })
      .then(function(s) { server = s; return s; });
    }

    it('runs Express in development mode, because NODE_ENV is never set', function() {
      return start_p().then(function(server) {
      // Consequence: an unhandled synchronous throw anywhere in the middleware
      // stack reaches finalhandler, which in development mode writes err.stack
      // to the response. There is no 4-arg error-handling middleware to stop
      // it. Recorded here so that adding one (or setting NODE_ENV) is a
      // deliberate, visible change rather than an accident.
      assert.strictEqual(process.env.NODE_ENV, undefined);
      assert.strictEqual(server.handle.app.get('env'), 'development');
      });
    });

    it('renders a 500 page, not a stack trace, when the app drops the connection', function() {
      // The app accepts the request and then destroys the socket without
      // answering, which is what http-proxy's 'error' event is for. That path
      // is handled (error500), so the user sees a rendered page rather than a
      // stack. Contrast with the finalhandler path above, which is not.
      return start_p({
        handler: function(req, res) {
          req.socket.destroy();
        }
      })
      .then(function(server) {
        return server.get_p('/myapp/');
      })
      .then(function(r) {
        assert.strictEqual(r.status, 500);
        assert.ok(/error has occurred/i.test(r.body),
          'expected the rendered 500 page, got: ' + r.body.slice(0, 400));
        assert.ok(!/\bat \w+ \(/.test(r.body),
          'a stack trace leaked into the error page: ' + r.body.slice(0, 400));
      });
    });

    it('serves a 503 page when the app is at capacity', function() {
      // simple_scheduler with max_requests 1 makes the second concurrent
      // request throw OutOfCapacityError synchronously out of
      // schedulerRegistry.getWorker, which httpListener catches by hand
      // (outside the promise chain) and turns into errorAppOverloaded.
      var release;
      var blocked = new Promise(function(resolve) { release = resolve; });

      return testServer.start_p(testConfig.siteDirConfig({
        locationBody: '    simple_scheduler 1;'
      }), {
        files: APP_FILES,
        worker: {
          handler: function(req, res) {
            blocked.then(function() {
              res.writeHead(200, {'Content-Type': 'text/plain'});
              res.end('ok');
            });
          }
        }
      })
      .then(function(s) {
        server = s;
        // First request opens a session and holds it.
        var first = s.get_p('/myapp/');
        return waitFor(function() {
          var entries = s.workerEntries();
          return entries.length === 1 && entries[0].sessionCount() >= 1;
        }, 'the first request to occupy the only session slot')
        .then(function() {
          return s.get_p('/myapp/');
        })
        .then(function(r) {
          release();
          return first.then(function() { return r; });
        });
      })
      .then(function(r) {
        assert.strictEqual(r.status, 503);
        assert.ok(/too many users/i.test(r.body),
          'expected the app-overloaded page, got: ' + r.body.slice(0, 400));
      });
    });
  });
});

/**
 * Polls until `predicate` is true, or fails the test after ~2 seconds.
 */
function waitFor(predicate, what) {
  var deadline = Date.now() + 2000;
  return new Promise(function(resolve, reject) {
    (function poll() {
      if (predicate()) return resolve();
      if (Date.now() > deadline)
        return reject(new Error('Timed out waiting for ' + what));
      setTimeout(poll, 10);
    })();
  });
}
