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