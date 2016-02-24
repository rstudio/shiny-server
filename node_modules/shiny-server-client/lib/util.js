"use strict";

const log = require("./log");
const pinkySwear = require("pinkyswear");

exports.createNiceBackoffDelayFunc = function() {
  // delays, in seconds; recycle the last value as needed
  let niceBackoff = [0, 1, 2, 3, 5];
  let pos = -1;
  return function() {
    pos = Math.min(++pos, niceBackoff.length - 1);
    return niceBackoff[pos] * 1000;
  };
};

// Call a function that returns a promise one or more times, until
// it either returns successfully, or time expires. Use a configurable
// delay in between attempts.
//
// progressCallbacks should be an EventEmitter or similar; it will be called
// with the following event names (and arguments):
//
// "schedule", delayMillis  // Called each time the next attempt is scheduled
// "attempt"                // Called each time an attempt begins
// "success"                // Called if retryPromise_p ends in success
// "failure"                // Called if retryPromise_p ends in failure
exports.retryPromise_p = function(create_p, delayFunc, expiration,
  progressCallbacks) {

  if (!progressCallbacks)
    progressCallbacks = {emit: () => {}};

  let promise = exports.promise();

  let delay = delayFunc();
  // Don't let the delay exceed the remaining time til expiration.
  delay = Math.min(delay, expiration - Date.now());
  // But in no case should the delay be less than zero, either.
  delay = Math.max(0, delay);

  setTimeout(function() {
    progressCallbacks.emit("attempt");

    create_p().then(
      function(value) {
        progressCallbacks.emit("success");
        promise(true, [value]);
      },
      function(err) {
        if (Date.now() >= expiration) {
          progressCallbacks.emit("failure");
          promise(false, [err]);
        } else {
          // Recurse. pinkySwear doesn't give us a way to easily
          // resolve a promise with another promise, so we have to
          // do it manually.
          exports.retryPromise_p(create_p, delayFunc, expiration, progressCallbacks).then(
            function() { promise(true, arguments); },
            function() { promise(false, arguments); }
          ).done();
        }
      }
    ).done();
  }, delay);

  progressCallbacks.emit("schedule", delay);

  return promise;
};

exports.createEvent = function(type, props) {
  if (global.document) {
    return new Event(type, props);
  } else if (props) {
    props.type = type;
    return props;
  } else {
    return {type: type};
  }
};

function addDone(prom) {
  prom.done = function() {
    prom.then(null, function(err) {
      log("Unhandled promise error: " + err);
      log(err.stack);
    });
  };
  return prom;
}
exports.promise = function() {
  return pinkySwear(addDone);
};

// PauseConnection is similar to pauseable streams
// in Node.js; used to delay events in case the
// process of registering event handlers has some
// asynchronicity to it. In our case, returning a
// connection as a promise means that whoever is
// waiting on the promise won't get a chance to
// register event listeners until at least one trip
// through the event loop.
//
// PauseConnection instances start out in the paused
// state, and must be manually resumed with .resume().
// The readyState is also paused, to ensure that it
// is in sync with the events (i.e. it'd be weird to
// see a connection transition to OPEN without onopen)
// but it is debatable whether this is more correct
// than having readyState always reflect the actual
// state of the underlying connection, because the
// underlying state is more relevant when it comes to
// calling send()/close() on this connection (which
// pass straight through to the underlying connection).
exports.PauseConnection = PauseConnection;
function PauseConnection(conn) {
  this._conn = conn;
  this._paused = true;
  this._events = [];
  this._timeout = null;
  this.readyState = conn.readyState;

  let pauseConnection = this;
  ["onopen", "onmessage", "onerror", "onclose"].forEach(evt => {
    conn[evt] = function() {
      if (pauseConnection._paused) {
        pauseConnection._events.push({event: evt, args: arguments, readyState: conn.readyState});
      } else {
        this.readyState = conn.readyState;
        pauseConnection[evt].apply(this, arguments);
      }
    };
  });
}

PauseConnection.prototype.resume = function() {
  this._timeout = setTimeout(() => {
    while (this._events.length) {
      let e = this._events.shift();
      this.readyState = e.readyState;
      this[e.event].apply(this, e.args);
    }
    this._paused = false;
  }, 0);
};
PauseConnection.prototype.pause = function() {
  clearTimeout(this._timeout);
  this._paused = true;
};

PauseConnection.prototype.close = function() {
  this._conn.close.apply(this._conn, arguments);
};
PauseConnection.prototype.send = function() {
  this._conn.send.apply(this._conn, arguments);
};

Object.defineProperty(PauseConnection.prototype, "url", {
  get: function() {
    return this._conn.url;
  }
});
Object.defineProperty(PauseConnection.prototype, "protocol", {
  get: function() {
    return this._conn.protocol;
  }
});
Object.defineProperty(PauseConnection.prototype, "extensions", {
  get: function() {
    return this._conn.extensions;
  }
});
