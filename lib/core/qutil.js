var Q = require('q');
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
    currentPromise.fin(function() {
      currentPromise = null;
    });
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