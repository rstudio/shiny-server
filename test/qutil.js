/*
 * test/qutil.js
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

// These helpers had no coverage at all, which is uncomfortable given that
// forEachPromise_p *is* the router chain's control flow and map_p's sequencing
// is load-bearing. They are also the code most likely to be rewritten when Q is
// replaced with native promises, so pin the semantics -- including the ones a
// naive port would get wrong.

var assert = require('assert');
var Q = require('q');
var qutil = require('../lib/core/qutil');

describe('qutil.forEachPromise_p', function() {
  // Accepts anything that isn't null/undefined, which is how the router chain
  // uses it: an AppSpec (or `true`) is a hit, a falsy value means "not mine".
  function acceptTruthy(x) { return !!x; }

  it('resolves with the first accepted value', function() {
    var seen = [];
    return qutil.forEachPromise_p(
      ['a', 'b', 'c'],
      function(item) { seen.push(item); return Q.resolve(item === 'a' ? 'hit' : null); },
      acceptTruthy,
      'fallback'
    )
    .then(function(result) {
      assert.strictEqual(result, 'hit');
      // Stops as soon as something is accepted; b and c are never tried.
      assert.deepStrictEqual(seen, ['a']);
    });
  });

  it('skips rejected candidates and keeps going', function() {
    var seen = [];
    return qutil.forEachPromise_p(
      ['a', 'b', 'c'],
      function(item) { seen.push(item); return Q.resolve(item === 'c' ? 'hit' : null); },
      acceptTruthy,
      'fallback'
    )
    .then(function(result) {
      assert.strictEqual(result, 'hit');
      assert.deepStrictEqual(seen, ['a', 'b', 'c']);
    });
  });

  it('visits the array strictly in order', function() {
    var seen = [];
    return qutil.forEachPromise_p(
      [1, 2, 3, 4],
      function(item) {
        seen.push(item);
        // Resolve on a delay that is *longer* for earlier items, so a
        // concurrent implementation would produce a different order.
        return Q.delay(null, (5 - item) * 5);
      },
      acceptTruthy,
      'fallback'
    )
    .then(function() {
      assert.deepStrictEqual(seen, [1, 2, 3, 4]);
    });
  });

  it('resolves with defaultValue when nothing is accepted', function() {
    return qutil.forEachPromise_p(
      ['a', 'b'],
      function() { return Q.resolve(null); },
      acceptTruthy,
      'fallback'
    )
    .then(function(result) {
      assert.strictEqual(result, 'fallback');
    });
  });

  it('resolves with defaultValue for an empty array without calling the iterator', function() {
    var called = false;
    return qutil.forEachPromise_p(
      [],
      function() { called = true; return Q.resolve('x'); },
      acceptTruthy,
      'fallback'
    )
    .then(function(result) {
      assert.strictEqual(result, 'fallback');
      assert.strictEqual(called, false);
    });
  });

  it('rejects the whole operation if any iterator promise rejects', function() {
    var seen = [];
    return qutil.forEachPromise_p(
      ['a', 'b', 'c'],
      function(item) {
        seen.push(item);
        if (item === 'b') return Q.reject(new Error('boom'));
        return Q.resolve(null);
      },
      acceptTruthy,
      'fallback'
    )
    .then(
      function() { throw new Error('should have rejected'); },
      function(err) {
        assert.strictEqual(err.message, 'boom');
        // Gives up immediately; 'c' is never tried.
        assert.deepStrictEqual(seen, ['a', 'b']);
      }
    );
  });

  it('rejects if the iterator throws synchronously', function() {
    // The try/catch around the iterator call matters: without it the throw
    // would escape tryNext() and become an unhandled exception rather than a
    // rejection, because tryNext is called from a promise callback.
    return qutil.forEachPromise_p(
      ['a'],
      function() { throw new Error('sync boom'); },
      acceptTruthy,
      'fallback'
    )
    .then(
      function() { throw new Error('should have rejected'); },
      function(err) { assert.strictEqual(err.message, 'sync boom'); }
    );
  });

  it('treats an accepted falsy value as a hit if accept says so', function() {
    // accept() is what decides, not truthiness. The router chain relies on
    // this to let `true` and an AppSpec both count as hits.
    return qutil.forEachPromise_p(
      ['a', 'b'],
      function(item) { return Q.resolve(item === 'b' ? 0 : null); },
      function(x) { return x !== null; },
      'fallback'
    )
    .then(function(result) {
      assert.strictEqual(result, 0);
    });
  });
});

describe('qutil.map_p', function() {
  it('resolves to the results in input order', function() {
    return qutil.map_p([1, 2, 3], function(n) {
      return Q.resolve(n * 10);
    })
    .then(function(results) {
      assert.deepStrictEqual(results, [10, 20, 30]);
    });
  });

  it('runs sequentially, not concurrently', function() {
    // This is the property a naive Promise.all() port would destroy. The
    // callers depend on it because each step can do I/O whose ordering matters.
    var inFlight = 0;
    var maxInFlight = 0;
    var order = [];

    return qutil.map_p([1, 2, 3, 4], function(n) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push('start ' + n);
      return Q.delay(null, (5 - n) * 5).then(function() {
        order.push('end ' + n);
        inFlight--;
        return n;
      });
    })
    .then(function(results) {
      assert.strictEqual(maxInFlight, 1, 'expected only one call in flight at a time');
      assert.deepStrictEqual(order, [
        'start 1', 'end 1',
        'start 2', 'end 2',
        'start 3', 'end 3',
        'start 4', 'end 4'
      ]);
      assert.deepStrictEqual(results, [1, 2, 3, 4]);
    });
  });

  it('resolves to an empty array for an empty collection', function() {
    return qutil.map_p([], function() {
      throw new Error('should not be called');
    })
    .then(function(results) {
      assert.deepStrictEqual(results, []);
    });
  });

  it('rejects and stops on the first failure', function() {
    var seen = [];
    return qutil.map_p([1, 2, 3], function(n) {
      seen.push(n);
      return n === 2 ? Q.reject(new Error('boom')) : Q.resolve(n);
    })
    .then(
      function() { throw new Error('should have rejected'); },
      function(err) {
        assert.strictEqual(err.message, 'boom');
        assert.deepStrictEqual(seen, [1, 2],
          'later items should not be started after a failure');
      }
    );
  });
});

describe('qutil.serialized', function() {
  // This is what guards config reload on SIGHUP: two signals in quick
  // succession must not run two reloads over the same mutable object graph.

  it('does not overlap invocations', function() {
    var inFlight = 0;
    var maxInFlight = 0;
    var completions = [];

    var work = qutil.serialized(function(label, delayMs) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return Q.delay(null, delayMs).then(function() {
        inFlight--;
        completions.push(label);
        return label;
      });
    });

    // Start the slow one first; if they overlapped, 'b' would finish first.
    var a = work('a', 40);
    var b = work('b', 1);

    return Q.all([a, b]).then(function() {
      assert.strictEqual(maxInFlight, 1);
      assert.deepStrictEqual(completions, ['a', 'b']);
    });
  });

  it('runs a queued invocation even if the one ahead of it fails', function() {
    var completions = [];
    var work = qutil.serialized(function(label, shouldFail) {
      return Q.delay(null, 5).then(function() {
        completions.push(label);
        if (shouldFail) throw new Error('boom-' + label);
        return label;
      });
    });

    var a = work('a', true);
    var b = work('b', false);

    return Q.allSettled([a, b]).then(function(states) {
      // Both actually ran, in order...
      assert.deepStrictEqual(completions, ['a', 'b']);
      assert.strictEqual(states[0].state, 'rejected');
      assert.strictEqual(states[0].reason.message, 'boom-a');

      // ...but see the "reports the *previous*..." test below: b's caller is
      // told about a's failure, not b's success.
      assert.strictEqual(states[1].state, 'rejected');
      assert.strictEqual(states[1].reason.message, 'boom-a');
    });
  });

  // KNOWN DEFECT, characterized rather than fixed.
  //
  // The queueing branch is `currentPromise.fin(function() { return wrapped(...) })`.
  // Q's .fin() waits for a promise returned by its callback, but it always
  // settles with the *original* promise's outcome. So a caller whose invocation
  // was queued is handed the outcome of whatever was running ahead of it.
  //
  // This is benign today only because nothing inspects the result: the sole
  // production user is loadConfig_p in lib/server-init.js, whose queued caller
  // is the SIGHUP handler, and that does `.eat()`. It is a live trap for the
  // Q-to-async/await port, where the obvious rewrite would silently change this.
  it('reports the *previous* invocation\'s outcome to a queued caller', function() {
    var work = qutil.serialized(function(label) {
      return Q.delay(label, 5);
    });

    var first = work('first');
    var second = work('second');

    return Q.all([first, second]).then(function(results) {
      assert.strictEqual(results[0], 'first');
      assert.strictEqual(results[1], 'first',
        'if this now reads "second", serialized() was fixed -- update this test');
    });
  });

  it('still queues a call made from the previous call\'s own .then handler', function() {
    // A corollary of the same mechanism: the internal `currentPromise = null`
    // runs a tick later than the caller's .then, so a follow-up call issued
    // from that handler is treated as queued rather than fresh -- and so gets
    // the previous result back.
    var calls = [];
    var work = qutil.serialized(function(label) {
      calls.push(label);
      return Q.delay(label, 1);
    });

    return work('first').then(function(r1) {
      assert.strictEqual(r1, 'first');
      return work('second');
    })
    .then(function(r2) {
      assert.deepStrictEqual(calls, ['first', 'second'],
        'the second call must really run, whatever it resolves to');
      assert.strictEqual(r2, 'first');
    });
  });

  it('starts genuinely fresh once the queue has fully drained', function() {
    var work = qutil.serialized(function(label) {
      return Q.delay(label, 1);
    });

    return work('first')
    // Detach from the previous promise chain so currentPromise is really null.
    .then(function() { return Q.delay(null, 10); })
    .then(function() { return work('second'); })
    .then(function(r2) {
      assert.strictEqual(r2, 'second');
    });
  });

  it('preserves `this`', function() {
    var obj = {
      name: 'obj',
      go: qutil.serialized(function() {
        return Q.resolve(this.name);
      })
    };
    return obj.go().then(function(name) {
      assert.strictEqual(name, 'obj');
    });
  });
});

describe('qutil.wrap', function() {
  it('resolves with the function result', function() {
    return qutil.wrap(function(a, b) { return a + b; })(2, 3)
    .then(function(result) { assert.strictEqual(result, 5); });
  });

  it('converts a synchronous throw into a rejection', function() {
    return qutil.wrap(function() { throw new Error('nope'); })()
    .then(
      function() { throw new Error('should have rejected'); },
      function(err) { assert.strictEqual(err.message, 'nope'); }
    );
  });

  it('preserves `this`', function() {
    var obj = {name: 'obj', go: qutil.wrap(function() { return this.name; })};
    return obj.go().then(function(name) { assert.strictEqual(name, 'obj'); });
  });
});

describe('promise.eat()', function() {
  it('swallows a rejection so it never becomes an unhandled error', function() {
    // Installed on Q.makePromise.prototype by requiring qutil. Modules under
    // test assume it is already there; .mocharc.json requires qutil for that
    // reason.
    var rejected = Q.reject(new Error('ignored'));
    assert.strictEqual(typeof rejected.eat, 'function');
    assert.strictEqual(rejected.eat(), undefined);
    // Give Q a chance to report an unhandled rejection if eat() failed to
    // attach a handler.
    return Q.delay(null, 10);
  });
});
