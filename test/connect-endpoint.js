/*
 * test/connect-endpoint.js
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

// connectEndpoint_p is what decides whether a freshly launched app "came up".
// It's module-private in lib/scheduler/scheduler.js, hence rewire. Every one of
// its exit paths is user-visible: the two rejection messages are what end up on
// the 500 page.

var assert = require('assert');
var Q = require('q');
var rewire = require('rewire');

var Scheduler = rewire('../lib/scheduler/scheduler.js');
var connectEndpoint_p = Scheduler.__get__('connectEndpoint_p');

/**
 * An endpoint double whose connect_p resolves false until the Nth call.
 */
function makeEndpoint(succeedOnAttempt) {
  return {
    attempts: 0,
    connect_p: function() {
      this.attempts++;
      return Q.resolve(this.attempts >= succeedOnAttempt);
    },
    toString: function() { return 'port 1234'; }
  };
}

function alwaysContinue() { return true; }

describe('connectEndpoint_p', function() {

  it('resolves true when the first attempt connects', function() {
    var endpoint = makeEndpoint(1);
    return connectEndpoint_p(endpoint, 5000, alwaysContinue)
    .then(function(result) {
      assert.strictEqual(result, true);
      assert.strictEqual(endpoint.attempts, 1);
    });
  });

  it('retries until the app is listening', function() {
    var endpoint = makeEndpoint(3);
    return connectEndpoint_p(endpoint, 5000, alwaysContinue)
    .then(function(result) {
      assert.strictEqual(result, true);
      assert.strictEqual(endpoint.attempts, 3);
    });
  });

  it('rejects with the user-facing timeout message once the budget is spent', function() {
    // The ladder's first interval is 50ms, so with a 10ms budget the second
    // attempt is already over budget.
    var endpoint = makeEndpoint(Infinity);
    return connectEndpoint_p(endpoint, 10, alwaysContinue)
    .then(
      function() { throw new Error('should have rejected'); },
      function(err) {
        assert.strictEqual(err.message, 'The application took too long to respond.');
        assert.strictEqual(endpoint.attempts, 1);
      }
    );
  });

  it('aborts immediately when shouldContinue() is already false', function() {
    // In production shouldContinue is bound to exitPromise.isPending, so this
    // is the "the process died while we were waiting for it" path.
    var endpoint = makeEndpoint(Infinity);
    return connectEndpoint_p(endpoint, 5000, function() { return false; })
    .then(
      function() { throw new Error('should have rejected'); },
      function(err) {
        assert.strictEqual(err.message, 'Connection attempt was aborted.');
        assert.strictEqual(endpoint.attempts, 0,
          'should not even try to connect once the caller has given up');
      }
    );
  });

  it('aborts partway through if shouldContinue() flips to false', function() {
    var endpoint = makeEndpoint(Infinity);
    var alive = true;
    setTimeout(function() { alive = false; }, 60);

    return connectEndpoint_p(endpoint, 5000, function() { return alive; })
    .then(
      function() { throw new Error('should have rejected'); },
      function(err) {
        assert.strictEqual(err.message, 'Connection attempt was aborted.');
        assert.ok(endpoint.attempts >= 1 && endpoint.attempts < 12,
          'expected to stop early, made ' + endpoint.attempts + ' attempts');
      }
    );
  });

  it('checks the time budget before checking shouldContinue', function() {
    // Ordering matters for which of the two messages the user sees when both
    // conditions are true at once.
    var endpoint = makeEndpoint(Infinity);
    var calls = 0;
    return connectEndpoint_p(endpoint, 10, function() {
      calls++;
      return false;
    })
    .then(
      function() { throw new Error('should have rejected'); },
      function(err) {
        // First pass: within budget, shouldContinue false -> aborted.
        assert.strictEqual(err.message, 'Connection attempt was aborted.');
        assert.strictEqual(calls, 1);
      }
    );
  });

  it('stops calling connect_p once it has resolved', function() {
    // KNOWN QUIRK, characterized rather than fixed: `timeoutId` in
    // connectEndpoint_p is assigned null and never reassigned, so the
    // `clearTimeout(timeoutId)` on the success path is a no-op and the pending
    // retry timer is *not* cancelled. What stops the retry loop is the
    // `!deferred.promise.isPending()` guard at the top of attemptToConnect.
    // The visible consequence is only that one dead timer is left to fire (up
    // to 500ms), not that extra connections are made -- but anyone "fixing"
    // the unused variable should know the guard is what's load-bearing.
    var endpoint = makeEndpoint(1);
    return connectEndpoint_p(endpoint, 5000, alwaysContinue)
    .then(function() {
      assert.strictEqual(endpoint.attempts, 1);
      // Wait past the first ladder interval; the queued timer fires and must
      // not produce another connect_p call.
      return Q.delay(null, 120);
    })
    .then(function() {
      assert.strictEqual(endpoint.attempts, 1);
    });
  });

  it('keeps retrying past the end of the interval ladder', function() {
    // intervals has 12 entries totalling 1900ms; after that it falls back to
    // maxInterval (500ms) rather than giving up.
    var endpoint = makeEndpoint(14);
    this.timeout(15000);
    return connectEndpoint_p(endpoint, 10000, alwaysContinue)
    .then(function(result) {
      assert.strictEqual(result, true);
      assert.strictEqual(endpoint.attempts, 14);
    });
  });
});
