/*
 * test/support/server.js
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

// Boots a real Shiny Server in-process on an ephemeral port and hands back
// something you can make HTTP requests against.

require('../../lib/core/log');
require('../../lib/core/qutil');

var http = require('http');

var server_init = require('../../lib/server-init');
var config = require('./config');
var fakeWorker = require('./fake-worker');

// Server startup is chatty at INFO. Tests that want the noise can set
// SHINY_LOG_LEVEL themselves.
if (!process.env.SHINY_LOG_LEVEL) {
  logger.setLevel('ERROR');
}

/**
 * Starts a server from the given config text.
 *
 * @param {string} configText - Config file body; see support/config.js#write
 *   for the substitutions applied.
 * @param {object} [options]
 * @param {object} [options.files] - Extra files to create in the config's temp
 *   directory, as a map of relative path to contents.
 * @param {object|false} [options.worker] - Options for the stand-in worker (see
 *   support/fake-worker.js#install), or false to leave the real launcher in
 *   place so that actual R processes are spawned.
 *
 * @returns {Promise} A promise of the test server handle.
 */
exports.start_p = start_p;
function start_p(configText, options) {
  options = options || {};

  var cfg = config.write(configText, options.files);
  var worker = options.worker === false ? null : fakeWorker.install(options.worker);

  // createServer_p resolves when the config is read and every socket has
  // settled. If any of that stalls, fail with something more useful than
  // mocha's bare "timeout of Nms exceeded".
  var timeoutMs = options.startTimeout || 10000;

  return withTimeout_p(server_init.createServer_p(cfg.path), timeoutMs,
    'Server startup did not complete within ' + timeoutMs + 'ms (config: ' +
    cfg.path + ')')
  .then(function(handle) {
    var addresses = handle.addresses();
    if (!addresses.length) {
      throw new Error('Server did not bind any address. Bind errors: ' +
        handle.bindErrors.map(function(e) { return e.message; }).join('; '));
    }
    return new TestServer(handle, cfg, worker, addresses[0].port);
  })
  .fail(function(err) {
    // Don't leak the temp dir or the patched launcher if startup failed.
    if (worker) worker.uninstall_p().eat();
    cfg.cleanup();
    throw err;
  });
}

/**
 * Rejects with `message` if `promise` hasn't settled within `ms`. Unlike
 * qutil.withTimeout_p, this clears its timer, so it doesn't keep the process
 * alive after a successful start.
 */
function withTimeout_p(promise, ms, message) {
  var Q = require('q');
  var deferred = Q.defer();
  var timer = setTimeout(function() {
    deferred.reject(new Error(message));
  }, ms);
  promise.then(
    function(value) { clearTimeout(timer); deferred.resolve(value); },
    function(err) { clearTimeout(timer); deferred.reject(err); }
  );
  return deferred.promise;
}

/**
 * Wraps Node's lowercased header object in the case-insensitive `get` accessor
 * that the Fetch API provides, so tests read the same either way.
 */
function makeHeaders(raw) {
  return {
    raw: raw,
    get: function(name) {
      var value = raw[String(name).toLowerCase()];
      return value === undefined ? null :
        (Array.isArray(value) ? value.join(', ') : value);
    }
  };
}

function TestServer(handle, cfg, worker, port) {
  this.handle = handle;
  this.config = cfg;
  this.worker = worker;
  this.port = port;
  this.baseUrl = 'http://127.0.0.1:' + port;
}

(function() {
  /**
   * Makes a request against this server and resolves to
   * `{status, headers, body}`, where `headers.get(name)` is case-insensitive.
   * Redirects are never followed -- several tests are about the redirect.
   *
   * Deliberately built on http.request with `agent: false` rather than on
   * global fetch(). fetch() pools keep-alive sockets per origin, test servers
   * are torn down and restarted within a millisecond or two of each other, and
   * ephemeral ports get recycled fast enough that a pooled socket belonging to
   * an already-dead server gets handed to the next test -- which fails as
   * "other side closed", an HTTP parse error, or (worse) a plausible-looking
   * response from the *previous* test's config. `Connection: close` is not a
   * workaround: fetch() treats Connection as a forbidden header and drops it
   * silently. One connection per request removes the whole class of problem.
   *
   * @param {string} path - Server-relative, e.g. "/__assets__/sockjs.min.js".
   * @param {object} [init] - {method, headers, body, timeout}.
   */
  this.get_p = function(path, init) {
    init = init || {};
    var url = this.baseUrl + path;
    var timeout = init.timeout || 8000;

    return new Promise(function(resolve, reject) {
      var req = http.request(url, {
        method: init.method || 'GET',
        headers: init.headers || {},
        agent: false
      }, function(res) {
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end', function() {
          resolve({
            status: res.statusCode,
            headers: makeHeaders(res.headers),
            body: Buffer.concat(chunks).toString('utf8'),
            res: res
          });
        });
        res.on('error', reject);
      });

      req.setTimeout(timeout, function() {
        req.destroy(new Error('Request to ' + url + ' timed out after ' +
          timeout + 'ms'));
      });
      req.on('error', reject);

      if (init.body) req.write(init.body);
      req.end();
    });
  };

  /** Alias, for tests that read better as `fetch`. */
  this.fetch = function(path, init) {
    return this.get_p(path, init);
  };

  /**
   * Every live WorkerEntry across every scheduler, so that tests can look at
   * the connection counters (`entry.data.httpConn` and friends) that
   * ShinyProxy's acquire/release pairs maintain.
   */
  this.workerEntries = function() {
    var schedulers = this.handle.schedulerRegistry.$schedulers;
    return Object.keys(schedulers).reduce(function(acc, key) {
      var workers = schedulers[key].$workers;
      return acc.concat(Object.keys(workers).map(function(id) {
        return workers[id];
      }));
    }, []);
  };

  this.stop_p = function() {
    var self = this;
    this.$destroyConnections();
    return this.handle.shutdown_p()
    .then(function() {
      return self.worker ? self.worker.uninstall_p() : null;
    })
    .fin(function() {
      self.config.cleanup();
    });
  };

  /**
   * Hangs up every established connection.
   *
   * Server#destroy() only stops accepting; it deliberately leaves existing
   * connections alone so that a real shutdown can let clients finish. That
   * means shutdown_p(), which waits for each listener's 'close' event, would
   * block until every lingering socket went away. Tests want teardown to be
   * immediate and unconditional.
   *
   * This reaches into Server's private tables on purpose; exposing it on the
   * facade would imply production code should do it, and it should not.
   */
  this.$destroyConnections = function() {
    var facade = this.handle.server;
    var servers = Object.values(facade.$wildcards)
      .concat(Object.values(facade.$hosts));
    servers.forEach(function(httpServer) {
      httpServer.closeAllConnections();
    });
  };
}).call(TestServer.prototype);
