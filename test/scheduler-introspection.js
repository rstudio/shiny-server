/*
 * test/scheduler-introspection.js
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

// Scheduler.shutdown() and Scheduler.dump() are the only places in the codebase
// that inspect a promise *synchronously*, via Q's isFulfilled() and
// inspect().value. Native promises have no equivalent, so both will need an
// actual design change during the Q removal -- most likely tracking the
// resolved handle on the WorkerEntry alongside the promise.
//
// The behaviour those two methods rely on is therefore pinned here in terms of
// observable outcomes ("a worker whose launch has completed gets killed; one
// still starting up does not"), so that a reimplementation can be checked
// against it without having to reproduce the Q idiom.

var assert = require('assert');
var Q = require('q');
var sinon = require('sinon');
var rewire = require('rewire');
var { AppSpec } = require('../lib/worker/app-spec.js');
var SimpleEventBus = require('../lib/events/simple-event-bus');

var Scheduler = rewire('../lib/scheduler/scheduler.js');

var appSpec = new AppSpec('/var/shiny-www/01_hello/', 'jeff', '', '/tmp', {});

describe('Scheduler introspection', function() {
  var scheduler;
  var killSpy;
  var launchDeferred;
  var exitDeferred;

  beforeEach(function() {
    killSpy = sinon.spy();
    launchDeferred = Q.defer();
    exitDeferred = Q.defer();

    Scheduler.__set__('app_worker', {
      launchWorker_p: function() {
        return launchDeferred.promise;
      }
    });

    scheduler = new Scheduler(new SimpleEventBus(), appSpec);
    scheduler.setTransport({
      alloc_p: function() {
        return Q({
          getLogFileSuffix: function() { return ''; },
          ToString: function() { return 'Port 1234'; },
          toString: function() { return 'port 1234'; },
          getSharedSecret: function() { return 'secret'; },
          connect_p: function() { return Q(true); },
          free: function() {}
        });
      }
    });
  });

  afterEach(function() {
    // Each spawned worker arms an idle timer (5s by default) that nothing in
    // these tests ever fires. Left armed, it keeps the mocha process alive for
    // five seconds after the last test and then logs a confusing "Failed to
    // kill process" from a worker whose test finished long ago.
    Object.values(scheduler.$workers).forEach(function(entry) {
      entry.close();
    });
  });

  function completeLaunch() {
    launchDeferred.resolve({
      kill: killSpy,
      getExit_p: function() { return exitDeferred.promise; },
      isRunning: function() { return true; }
    });
    // Let spawnWorker's promise chain run to the point where the WorkerEntry's
    // promise is resolved with an AppWorkerHandle.
    return Q.delay(null, 20);
  }

  describe('shutdown()', function() {
    it('kills a worker whose launch has completed', function() {
      scheduler.spawnWorker(appSpec, null, true);
      return completeLaunch().then(function() {
        scheduler.shutdown();
        assert.strictEqual(killSpy.callCount, 1);
        // `true` means "notify the app first" -- a graceful shutdown.
        assert.deepStrictEqual(killSpy.firstCall.args, [true]);
      });
    });

    it('leaves a still-launching worker alone', function() {
      // The launch promise is still pending, so isFulfilled() is false and
      // inspect().value would be undefined; calling .kill on it would throw.
      scheduler.spawnWorker(appSpec, null, true);
      return Q.delay(null, 20).then(function() {
        assert.doesNotThrow(function() { scheduler.shutdown(); });
        assert.strictEqual(killSpy.callCount, 0);
      });
    });

    it('does not throw when a worker failed to launch', function() {
      scheduler.spawnWorker(appSpec, null, true);
      launchDeferred.reject(new Error('R would not start'));
      return Q.delay(null, 20).then(function() {
        assert.doesNotThrow(function() { scheduler.shutdown(); });
        assert.strictEqual(killSpy.callCount, 0);
      });
    });

    it('swallows an error thrown by kill()', function() {
      // One uncooperative worker must not stop the others from being killed.
      killSpy = sinon.stub().throws(new Error('no such process'));
      scheduler.spawnWorker(appSpec, null, true);
      return completeLaunch().then(function() {
        assert.doesNotThrow(function() { scheduler.shutdown(); });
        assert.strictEqual(killSpy.callCount, 1);
      });
    });

    it('does nothing when there are no workers', function() {
      assert.doesNotThrow(function() { scheduler.shutdown(); });
      assert.strictEqual(killSpy.callCount, 0);
    });
  });

  describe('dump()', function() {
    var logged;
    var origLog;

    beforeEach(function() {
      logged = [];
      origLog = console.log;
      console.log = function() {
        logged.push(Array.prototype.join.call(arguments, ' '));
      };
    });

    afterEach(function() {
      console.log = origLog;
    });

    it('summarizes a launched worker', function() {
      scheduler.spawnWorker(appSpec, null, true);
      return completeLaunch().then(function() {
        scheduler.dump();
        assert.strictEqual(logged.length, 1);
        // summarizeWorker() pulls appSpec, endpoint and logFilePath off the
        // resolved AppWorkerHandle.
        assert.ok(/Port 1234/.test(logged[0]),
          'expected the endpoint in the dump, got: ' + logged[0]);
      });
    });

    it('reports an unresolved worker rather than throwing', function() {
      scheduler.spawnWorker(appSpec, null, true);
      return Q.delay(null, 20).then(function() {
        scheduler.dump();
        assert.deepStrictEqual(logged, ['[unresolved promise]']);
      });
    });

    it('does nothing when there are no workers', function() {
      scheduler.dump();
      assert.deepStrictEqual(logged, []);
    });
  });
});
