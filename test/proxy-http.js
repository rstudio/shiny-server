/*
 * test/proxy-http.js
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

// ShinyProxy.httpListener had no unit coverage at all -- test/proxy-events.js
// only greps http-proxy for event names. What is pinned here is its dispatch
// contract: the tri-state the router chain returns, and the two error paths
// that are handled by hand rather than by the promise chain.

var assert = require('assert');
var Q = require('q');
var proxy_http = require('../lib/proxy/http');
var OutOfCapacityError = require('../lib/core/errors').OutOfCapacity;
var AppSpec = require('../lib/worker/app-spec').AppSpec;

describe('ShinyProxy.httpListener', function() {

  function makeAppSpec(prefix) {
    return new AppSpec('/some/app', 'someuser', prefix || '/app', '/some/logs', {
      appDefaults: {sanitizeErrors: false},
      templateDir: null
    });
  }

  /**
   * A response double that records what was written and resolves `done_p` once
   * end() is called, since httpListener answers asynchronously.
   */
  function makeRes() {
    var deferred = Q.defer();
    var res = {
      statusCode: null,
      headers: null,
      body: '',
      finished: false,
      proxySuccess: false,
      $listeners: {},
      done_p: deferred.promise,

      writeHead: function(status, headers) {
        this.statusCode = status;
        this.headers = headers;
      },
      setHeader: function() {},
      end: function(chunk) {
        if (chunk) this.body += chunk;
        if (!this.finished) {
          this.finished = true;
          deferred.resolve(this);
        }
      },
      on: function(event, listener) {
        (this.$listeners[event] = this.$listeners[event] || []).push(listener);
      },
      emit: function(event) {
        (this.$listeners[event] || []).forEach(function(l) { l(); });
      }
    };
    return res;
  }

  function makeReq(url) {
    var parts = String(url).split('?');
    return {
      url: url,
      method: 'GET',
      headers: {},
      socket: {writable: true},
      _parsedUrl: {pathname: parts[0], query: parts[1] || null},
      paused: false,
      resumed: false,
      pause: function() { this.paused = true; },
      resume: function() { this.resumed = true; },
      on: function() {}
    };
  }

  /**
   * Builds a ShinyProxy whose router resolves to `appSpecValue` and whose
   * scheduler registry behaves as `getWorker` says.
   */
  function makeProxy(appSpecValue, getWorker) {
    var router = {
      getAppSpec_p: function() {
        return Q.resolve(appSpecValue);
      }
    };
    var schedulerRegistry = {
      getWorker: getWorker || function() {
        throw new Error('getWorker should not have been called');
      }
    };
    return new proxy_http.ShinyProxy(router, schedulerRegistry);
  }

  it('pauses the request immediately', function() {
    var proxy = makeProxy(null);
    var req = makeReq('/whatever');
    var res = makeRes();
    proxy.httpListener(req, res);
    // Synchronously, before the router promise has settled -- otherwise events
    // could be missed while the router is being consulted.
    assert.strictEqual(req.paused, true);
    return res.done_p;
  });

  it('does nothing when the router returns exactly true', function() {
    // "true" means the router already answered the request itself (a redirect,
    // a directory index, /ping). Anything written here would corrupt that.
    var proxy = makeProxy(true);
    var req = makeReq('/handled');
    var res = makeRes();
    proxy.httpListener(req, res);

    return Q.delay(null, 20).then(function() {
      assert.strictEqual(res.finished, false);
      assert.strictEqual(res.statusCode, null);
    });
  });

  it('404s when the router returns a falsy value', function() {
    var proxy = makeProxy(null);
    var req = makeReq('/nope');
    var res = makeRes();
    proxy.httpListener(req, res);

    return res.done_p.then(function() {
      assert.strictEqual(res.statusCode, 404);
    });
  });

  [undefined, false, 0, ''].forEach(function(value) {
    it('404s when the router returns ' + JSON.stringify(value), function() {
      var proxy = makeProxy(value);
      var req = makeReq('/nope');
      var res = makeRes();
      proxy.httpListener(req, res);
      return res.done_p.then(function() {
        assert.strictEqual(res.statusCode, 404);
      });
    });
  });

  it('uses a strict === true check, so a truthy non-AppSpec is not "handled"', function() {
    // The check is `appSpec === true`, not `appSpec == true`. A router that
    // returned 1 would fall through to the AppSpec path and be asked for a
    // prefix, rather than being treated as having answered. Pinning this
    // because "=== true" looks like something a refactor would relax.
    var proxy = makeProxy(1);
    var req = makeReq('/whatever');
    var res = makeRes();
    proxy.httpListener(req, res);

    return res.done_p.then(function() {
      // 1 has no .prefix, so the prefix check fails and the code reaches for
      // `appSpec.settings.templateDir` to render the 404 -- which throws, and
      // the outer .fail() turns that into a 500. An ugly answer, but an
      // unmistakable one: a truthy non-true value is emphatically not treated
      // as "the router already handled it".
      assert.strictEqual(res.statusCode, 500);
    });
  });

  it('does nothing if the socket has already closed', function() {
    var proxy = makeProxy(makeAppSpec('/app'));
    var req = makeReq('/app/');
    req.socket.writable = false;
    var res = makeRes();
    proxy.httpListener(req, res);

    return Q.delay(null, 20).then(function() {
      assert.strictEqual(res.finished, false);
    });
  });

  it('404s when the router returns a prefix the URL does not start with', function() {
    // Defends against a buggy router; the alternative would be slicing the URL
    // with a bad offset and proxying nonsense upstream.
    var proxy = makeProxy(makeAppSpec('/somewhere-else'));
    var req = makeReq('/app/page');
    var res = makeRes();
    proxy.httpListener(req, res);

    return res.done_p.then(function() {
      assert.strictEqual(res.statusCode, 404);
    });
  });

  it('serves a 503 when the scheduler reports OutOfCapacity', function() {
    // getWorker is called outside the promise chain, in a bare try/catch,
    // precisely so that a *synchronous* OutOfCapacityError can be turned into a
    // 503 instead of escaping as an unhandled exception. Both halves of that
    // arrangement are what this test protects.
    var proxy = makeProxy(makeAppSpec('/app'), function() {
      throw new OutOfCapacityError('no room');
    });
    var req = makeReq('/app/');
    var res = makeRes();
    proxy.httpListener(req, res);

    return res.done_p.then(function() {
      assert.strictEqual(res.statusCode, 503);
      assert.ok(/too many users/i.test(res.body),
        'expected the app-overloaded page, got: ' + res.body.slice(0, 200));
    });
  });

  it('turns any other synchronous getWorker error into a 500', function() {
    var proxy = makeProxy(makeAppSpec('/app'), function() {
      throw new Error('something else went wrong');
    });
    var req = makeReq('/app/');
    var res = makeRes();
    proxy.httpListener(req, res);

    return res.done_p.then(function() {
      assert.strictEqual(res.statusCode, 500);
    });
  });

  it('500s when the router itself rejects', function() {
    var router = {
      getAppSpec_p: function() { return Q.reject(new Error('bad config')); }
    };
    var proxy = new proxy_http.ShinyProxy(router, {});
    var req = makeReq('/app/');
    var res = makeRes();
    proxy.httpListener(req, res);

    return res.done_p.then(function() {
      assert.strictEqual(res.statusCode, 500);
    });
  });

  it('404s when getting the worker handle fails with ENOTFOUND', function() {
    var err = new Error('no such app');
    err.code = 'ENOTFOUND';
    var proxy = makeProxy(makeAppSpec('/app'), function() {
      return makeWorkerEntry(Q.reject(err));
    });
    var req = makeReq('/app/');
    var res = makeRes();
    proxy.httpListener(req, res);

    return res.done_p.then(function() {
      assert.strictEqual(res.statusCode, 404);
    });
  });

  it('500s when getting the worker handle fails for any other reason', function() {
    var proxy = makeProxy(makeAppSpec('/app'), function() {
      return makeWorkerEntry(Q.reject(new Error('the app failed to start')));
    });
    var req = makeReq('/app/');
    var res = makeRes();
    proxy.httpListener(req, res);

    return res.done_p.then(function() {
      assert.strictEqual(res.statusCode, 500);
      assert.ok(/failed to start/i.test(res.body),
        'expected the failure detail in the page, got: ' + res.body.slice(0, 300));
    });
  });

  describe('connection accounting', function() {
    it('acquires http, and pending for an app page, then releases on finish', function() {
      var entry = makeWorkerEntry(Q.defer().promise);
      var proxy = makeProxy(makeAppSpec('/app'), function() { return entry; });
      var req = makeReq('/app/');
      var res = makeRes();
      proxy.httpListener(req, res);

      return Q.delay(null, 20).then(function() {
        assert.deepStrictEqual(entry.acquired, ['http', 'pending']);
        res.proxySuccess = true;
        res.emit('finish');
        assert.deepStrictEqual(entry.released, ['http']);
        // A successful app page keeps its "pending" reservation, backed by a
        // timer, because a SockJS session is expected imminently.
        assert.deepStrictEqual(entry.pendingTimers, [45 * 1000]);
      });
    });

    it('releases the pending reservation when the app page did not succeed', function() {
      var entry = makeWorkerEntry(Q.defer().promise);
      var proxy = makeProxy(makeAppSpec('/app'), function() { return entry; });
      var req = makeReq('/app/');
      var res = makeRes();
      proxy.httpListener(req, res);

      return Q.delay(null, 20).then(function() {
        res.proxySuccess = false;
        res.emit('close');
        assert.deepStrictEqual(entry.released, ['http', 'pending']);
        assert.deepStrictEqual(entry.pendingTimers, []);
      });
    });

    it('cleans up only once even if both finish and close fire', function() {
      // The cleanup is wrapped in _.once, and it is registered on both events
      // because which of them fires (and in what order) depends on the Node
      // version and on whether compression wrapped res.end.
      var entry = makeWorkerEntry(Q.defer().promise);
      var proxy = makeProxy(makeAppSpec('/app'), function() { return entry; });
      var req = makeReq('/app/');
      var res = makeRes();
      proxy.httpListener(req, res);

      return Q.delay(null, 20).then(function() {
        res.emit('finish');
        res.emit('close');
        assert.deepStrictEqual(entry.released, ['http', 'pending']);
      });
    });

    it('does not take a pending reservation for a non-app-page URL', function() {
      var entry = makeWorkerEntry(Q.defer().promise);
      var proxy = makeProxy(makeAppSpec('/app'), function() { return entry; });
      var req = makeReq('/app/style.css');
      var res = makeRes();
      proxy.httpListener(req, res);

      return Q.delay(null, 20).then(function() {
        assert.deepStrictEqual(entry.acquired, ['http']);
        res.emit('finish');
        assert.deepStrictEqual(entry.released, ['http']);
      });
    });

    it('does not take a pending reservation when a specific worker was requested', function() {
      // isAppPage is `!worker && isAppPagePath(...)`: an explicit ?w= means the
      // client already has a session, so no new one should be reserved.
      var entry = makeWorkerEntry(Q.defer().promise);
      var proxy = makeProxy(makeAppSpec('/app'), function() { return entry; });
      var req = makeReq('/app/?w=abc123');
      var res = makeRes();
      proxy.httpListener(req, res);

      return Q.delay(null, 20).then(function() {
        assert.deepStrictEqual(entry.acquired, ['http']);
      });
    });
  });

  it('passes the parsed ?w= worker id through to the scheduler', function() {
    var seen = {};
    var proxy = makeProxy(makeAppSpec('/app'), function(appSpec, pathname, worker) {
      seen.pathname = pathname;
      seen.worker = worker;
      return makeWorkerEntry(Q.defer().promise);
    });
    var req = makeReq('/app/sub/page?w=abc123&other=1');
    var res = makeRes();
    proxy.httpListener(req, res);

    return Q.delay(null, 20).then(function() {
      assert.strictEqual(seen.worker, 'abc123');
      // The prefix has been stripped and the query removed by this point.
      assert.strictEqual(seen.pathname, '/sub/page');
    });
  });
});

/**
 * A WorkerEntry double that records acquire/release calls.
 */
function makeWorkerEntry(handle_p) {
  return {
    acquired: [],
    released: [],
    pendingTimers: [],
    acquire: function(type) { this.acquired.push(type); },
    release: function(type) { this.released.push(type); },
    pushPendingReleaseTimer: function(ms) { this.pendingTimers.push(ms); },
    getAppWorkerHandle_p: function() { return handle_p; }
  };
}
