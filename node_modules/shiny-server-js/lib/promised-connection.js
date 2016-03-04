let WebSocket = require("./websocket");

module.exports = PromisedConnection;
function PromisedConnection() {
  this._conn = null;
  this._closed = false;
}

PromisedConnection.prototype.resolve = function(err, conn) {
  if (err) {
    this._closed = true;
    // TODO: raise onerror
    // TODO: raise onclose
  }

  this._conn = conn;
  if (this._closed) {
    this._conn.close.apply(this._conn, this._closed);
  } else {
    this._conn.onclose = (evt) => {
      if (this.onclose)
        this.onclose(evt);
    };
    this._conn.onopen = (evt) => {
      if (this.onopen)
        this.onopen(evt);
    };
    this._conn.onmessage = (evt) => {
      if (this.onmessage)
        this.onmessage(evt);
    };
    this._conn.onerror = (evt) => {
      if (this.onerror)
        this.onerror(evt);
    };
  }
};

PromisedConnection.prototype.close = function(code, reason) {
  // Already closed; no-op.
  if (this._closed) {
    return;
  }

  // Set _closed to arguments instead of true; arguments is
  // truthy and it also lets us send the arguments to the real
  // connection if necessary
  this._closed = arguments;
  if (this._conn) {
    // If we already have the connection, close it. If not, we
    // rely on the promise callback to check the _closed flag.
    // Use the tortured .apply() form because both parameters
    // are optional.
    this._conn.close.apply(this._conn, arguments);
  } else {
    setTimeout(() => {
      if (this.onclose) {
        let evt = util.createEvent("close", {
          currentTarget: this,
          target: this,
          srcElement: this,
          code: code || 1005,
          reason: reason || "",
          wasClean: true
        });
        this.onclose(evt);
      }
    }, 0);
  }
};

PromisedConnection.prototype.send = function(data) {
  if (this._conn) {
    return this._conn.send(data);
  } else if (this.readyState === WebSocket.CONNECTING) {
    throw new Error("Can't execute 'send' on 'WebSocket' when in CONNECTING state.");
  } else if (this.readyState === WebSocket.CLOSED) {
    throw new Error("Can't execute 'send' on 'WebSocket' when in CLOSED state.");
  } else if (this.readyState === WebSocket.CLOSING) {
    throw new Error("Can't execute 'send' on 'WebSocket' when in CLOSING state.");
  }
};

// Convenience method for returning a property on the connection, or
// if the promise is pending or failed, return some other value.
PromisedConnection.prototype._getConnProperty = function(prop, ifPending, ifFailed) {
  if (!this._conn && this._closed) {
    // Failure
    return ifFailed;
  } else if (this._conn) {
    // Success
    return this._conn[prop];
  } else { // this._connPromise() === undefined
    return ifPending;
  }
};

// Proxy some properties

Object.defineProperty(PromisedConnection.prototype, "readyState", {
  get: function readyState() {
    if (this._closed)
      return WebSocket.CLOSED;
    else
      return this._getConnProperty("readyState", WebSocket.CONNECTING, WebSocket.CLOSED);
  }
});

Object.defineProperty(PromisedConnection.prototype, "protocol", {
  get: function protocol() {
    return this._getConnProperty("readyState", "", "");
  }
});

Object.defineProperty(PromisedConnection.prototype, "extensions", {
  get: function protocol() {
    return this._getConnProperty("extensions", "", "");
  }
});
