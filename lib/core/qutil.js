/*
 * qutil.js
 *
 * Copyright (C) 2009-13 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
var assert = require('assert');
var Q = require('q');
var _ = require('underscore');

/**
 * Adds an eat() method to promises that swallows exceptions.
 */
Q.makePromise.prototype.eat = function() {
  this.fail(function(err) {});
};

exports.serialized = serialized;
/**
 * Takes a function that returns a promise, and returns a wrapped version that
 * ensures that multiple invocations are serialized (only one at a time).
 */
function serialized(func) {
  var currentPromise = null;
  var wrapped = function() {
    var self = this;
    var args = arguments;
    if (currentPromise) {
      return currentPromise.fin(function() {
        return wrapped.apply(self, args);
      });
    }

    currentPromise = func.apply(self, args);
    
    currentPromise
    .fin(function() {
      currentPromise = null;
    })
    .eat();
    
    return currentPromise;
  };
  return wrapped;
}

exports.withTimeout_p = withTimeout_p;
/**
 * If timeoutMs elapses before promise resolves, the returned promise will
 * fail with an Error whose code is 'ETIMEOUT'. Otherwise the returned promise
 * passes through the resolution/failure of the original promise.
 */
function withTimeout_p(timeoutMs, promise, label) {
  label = label || 'Operation';
  var defer = Q.defer();
  promise.then(
    function(value) {
      defer.resolve(value);
    },
    function(err) {
      defer.reject(err);
    }
  );
  setTimeout(function() {
    var err = new Error(label + ' timed out');
    err.code = 'ETIMEOUT';
    defer.reject(err);
  }, timeoutMs);
  return defer.promise;
}

exports.forEachPromise_p = forEachPromise_p;
/**
 * Starting at the beginning of the array, pass an element to the iterator,
 * which should return a promise. If the promise resolves, test the value
 * using the accept function. If accepted, that value is the result. If not
 * accepted, move on to the next array element.
 *
 * If any of the iterator-produced promises fails, then reject the overall
 * promise with that error.
 *
 * If the end of the array is reached without any values being accepted,
 * defaultValue is the result.
 */
function forEachPromise_p(array, iterator, accept, defaultValue) {
  var deferred = Q.defer();
  var i = 0;
  function tryNext() {
    if (i >= array.length) {
      // We've reached the end of the list--give up
      deferred.resolve(defaultValue);
    }
    else {
      try {
        // Try the next item in the list
        iterator(array[i++])
        .then(
          function(result) {
            // If the promise returns a result, see if it is acceptable; if
            // so, we're done, otherwise move on to the next item in the list
            if (accept(result)) {
              deferred.resolve(result);
            } else {
              tryNext();
            }
          },
          function(err) {
            deferred.reject(err);
          }
        );
      } catch(ex) {
        deferred.reject(ex);
      }
    }
  }
  tryNext();
  return deferred.promise;
}

exports.fapply = fapply;
/**
 * Apply a synchronous function but wrap the result or exception in a promise.
 * Why doesn't Q.apply work this way??
 */
function fapply(func, object, args) {
  try {
    return Q.resolve(func.apply(object, args));
  } catch(err) {
    return Q.reject(err);
  }
}

/**
 * Pass in a synchronous function, returns a promise-returning version
 */
exports.wrap = wrap;
function wrap(func) {
  return function() {
    try {
      return Q.resolve(func.apply(this, arguments));
    } catch(err) {
      return Q.reject(err);
    }
  }
}

exports.map_p = map_p;
/**
 * Pass in a collection and a promise-returning function, and map_p will
 * do a sequential map operation and resolve to the results.
 */
function map_p(collection, func_p) {
  if (collection.length === 0)
    return Q.resolve([]);

  var results = [];

  var lastFunc = Q.resolve(true);

  _.each(collection, function(el, index) {
    lastFunc = lastFunc.then(function() {
      return func_p(collection[index])
      .then(function(result) {
	results[index] = result;
	return results;
      });
    });
  });

  return lastFunc;
}
