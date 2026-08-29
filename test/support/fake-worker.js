/*
 * test/support/fake-worker.js
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

// Stands in for an R or Python worker process, so that integration tests can
// exercise the whole request path without R installed and without paying
// process-spawn latency.
//
// The seam is lib/worker/app-worker's `launchWorker_p` export. Scheduler
// resolves it as a property at call time (see the `let app_worker` comment in
// lib/scheduler/scheduler.js), so reassigning the export is enough -- no rewire,
// which matters because rewire would produce a second copy of the module that
// the server built by lib/server-init.js would never see.
//
// Everything else stays real: the real TcpTransport allocates a real ephemeral
// port, the fake worker binds a real http.Server to it, and Scheduler's
// connectEndpoint_p really connects before the proxy really proxies. The only
// thing that does not happen is `su`-ing to another user and exec'ing R, which
// is also why the config under test must `run_as` the current user --
// Scheduler calls posix.getpwnam(appSpec.runAs) regardless of this stub.

var http = require('http');
var Q = require('q');
var app_worker = require('../../lib/worker/app-worker');

/**
 * Replaces app_worker.launchWorker_p with one that starts an in-process HTTP
 * server on the endpoint's port.
 *
 * @param {object} [options]
 * @param {function} [options.handler] - (req, res, worker) request handler for
 *   the stand-in app. Defaults to a 200 that echoes the request as JSON.
 * @param {function} [options.onUpgrade] - (req, socket, head, worker) handler
 *   for websocket upgrades against the stand-in app.
 *
 * @returns {object} A control object. Call `uninstall_p()` in an `afterEach`;
 *   it restores the real launcher and shuts down every stand-in worker.
 */
exports.install = install;
function install(options) {
  options = options || {};
  var handler = options.handler || echoHandler;

  var original = app_worker.launchWorker_p;
  var workers = [];

  app_worker.launchWorker_p = function(appSpec, pw, endpoint, logFilePath, workerId) {
    var worker = new FakeAppWorker(appSpec, endpoint, logFilePath, workerId,
      handler, options.onUpgrade);
    workers.push(worker);
    // Must be a Q promise: Scheduler calls .invoke('getExit_p') on it.
    return worker.$listening_p.then(function() { return worker; });
  };

  return {
    /** Every stand-in worker launched since install(), in launch order. */
    workers: workers,

    /** The most recently launched stand-in worker. */
    last: function() {
      return workers[workers.length - 1];
    },

    /** Every request any stand-in worker has received, in arrival order. */
    requests: function() {
      return workers.reduce(function(acc, w) {
        return acc.concat(w.requests);
      }, []);
    },

    uninstall_p: function() {
      app_worker.launchWorker_p = original;
      return Q.all(workers.map(function(w) { return w.destroy_p(); }));
    }
  };
}

/**
 * Implements the slice of the AppWorker interface that Scheduler uses:
 * getExit_p(), isRunning(), and kill().
 */
function FakeAppWorker(appSpec, endpoint, logFilePath, workerId, handler, onUpgrade) {
  var self = this;

  this.appSpec = appSpec;
  this.endpoint = endpoint;
  this.logFilePath = logFilePath;
  this.workerId = workerId;

  /** Requests this stand-in app received, as {method, url, headers}. */
  this.requests = [];

  this.$exit = Q.defer();
  this.$running = true;

  this.server = http.createServer(function(req, res) {
    self.requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers
    });
    handler(req, res, self);
  });

  if (onUpgrade) {
    this.server.on('upgrade', function(req, socket, head) {
      onUpgrade(req, socket, head, self);
    });
  }

  this.$listening_p = Q.Promise(function(resolve, reject) {
    self.server.once('error', reject);
    // TcpTransport picked this port by binding and immediately closing a probe
    // socket, so there is a small window in which someone else could take it.
    // If that happens the launch fails, exactly as a real worker's would.
    self.server.listen(+endpoint.getAppWorkerPort(), '127.0.0.1', function() {
      resolve();
    });
  });
}

(function() {
  this.getExit_p = function() {
    return this.$exit.promise;
  };

  this.isRunning = function() {
    return this.$running;
  };

  /**
   * Simulates the worker process going away. Scheduler binds this as the
   * AppWorkerHandle's kill function and calls it on idle timeout and shutdown.
   */
  this.kill = function(force) {
    if (!this.$running)
      return;
    this.$running = false;
    var self = this;
    this.server.close(function() {
      self.$exit.resolve(0);
    });
    this.server.closeAllConnections();
  };

  this.destroy_p = function() {
    this.kill(true);
    return this.$exit.promise;
  };
}).call(FakeAppWorker.prototype);

/**
 * The default stand-in app: 200 with a JSON echo of what it received. Enough
 * for tests that only care that the proxy delivered the request and relayed the
 * response.
 */
exports.echoHandler = echoHandler;
function echoHandler(req, res) {
  var body = JSON.stringify({
    url: req.url,
    method: req.method,
    sharedSecret: req.headers['shiny-shared-secret'] || null
  });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
