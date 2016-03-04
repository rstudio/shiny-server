let assert = require("assert");
let EventEmitter = require("events").EventEmitter;

let inherits = require("inherits");

let debug = require("../debug");
let log = require("../log");
let util = require("../util");
let WebSocket = require("../websocket");

let BaseConnectionDecorator = require("./base-connection-decorator");
let MessageBuffer = require("../../common/message-buffer");
let MessageReceiver = require("../../common/message-receiver");
let message_utils = require("../../common/message-utils");
let pathParams = require("../../common/path-params");

function generateId(size){
  let chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = '';
  for (let i=0; i < size; i++) {
    let rnum = Math.floor(Math.random() * chars.length);
    id += chars.substring(rnum,rnum+1);
  }
  return id;
};

// The job of this decorator is to serve as a "logical"
// connection that can survive the death of a "physical"
// connection, and restore the connection.
//
// * Reads from options: reconnectTimeout (in millis; <0 to disable)
// * Writes to ctx: params.n or params.o
// * Reads from ctx: nothing
exports.decorate = function(factory, options) {
  // Returns a connection promise
  return function(url, ctx, callback) {

    // The robustId is an id that will be shared by all
    // physical connections belonging to this logical
    // connection. We will include it in the URL.
    let robustId = generateId(18);

    let timeout = options.reconnectTimeout;
    if (typeof(timeout) === "undefined") {
      timeout = 15000;
    }

    let conn = new RobustConnection(timeout, factory, url, ctx, robustId);
    conn = new BufferedResendConnection(conn);
    callback(null, conn);
  };
};

// Utility function takes a (potentially still CONNECTING)
// connection, and returns a promise. The promise resolves
// successfully if onopen is called, and resolves as an
// error if onerror or onclose is called.
function promisify_p(conn) {

  let promise = util.promise();
  if (conn.readyState === WebSocket.OPEN) {
    promise(true, [conn]);
  } else if (conn.readyState === WebSocket.CLOSING || conn.readyState === WebSocket.CLOSED) {
    promise(false, [new Error("WebSocket was closed")]);
  } else if (conn.readyState === WebSocket.CONNECTING){
    conn.onopen = function() {
      conn.onopen = null;
      conn.onclose = null;
      conn.onerror = null;
      // PauseConnection helps avoid a race condition here. Between
      // conn.onopen being called and the promise resolution code
      // (onFulfilled/onRejected) being invoked, there's more than
      // enough time for onmessage/onerror/onclose events to occur.
      // You can see this if you have the server write a message
      // right away upon connection; that message will be dropped
      // because onmessage will be called before onFulfilled has
      // a chance to assign its onmessage callback. So we use a
      // paused connection that we can then resume() once all of
      // the appropriate callbacks are hooked up.
      //
      // There may still be a race condition in that the connection
      // might fire its onopen event between the time that the
      // factory creates it, and promisify_p is invoked. That at
      // least will manifest itself as a "stuck" connection, rather
      // than silently dropping a single message, which could be
      // much harder for the user to know that something is wrong.
      promise(true, [new util.PauseConnection(conn)]);
    };
    conn.onerror = function(e) {
      conn.onopen = null;
      conn.onclose = null;
      conn.onerror = null;
      promise(false, [new Error("WebSocket errored"), e]);
    };
    conn.onclose = function(e) {
      conn.onopen = null;
      conn.onclose = null;
      conn.onerror = null;
      promise(false, [new Error("WebSocket closed"), e]);
    };
  } else {
    throw new Error("Unexpected WebSocket readyState: " + conn.readyState);
  }

  return promise;
}

/*
Things that can move this robust connection into different states:

1) On construction, it's in CONNECTING.
2) On successful open of its first connection, it's OPEN.
3) On close() being called, it goes straight to CLOSED.
4) When a disconnect with !evt.wasClean occurs, attempt to
   reconnect; stay in OPEN. If we give up on this, then
   go to CLOSED.
5) When a wasClean disconnect occurs, go to CLOSED.
*/

function RobustConnection(timeout, factory, url, ctx, robustId) {
  this._timeout = timeout;
  this._factory = factory;
  this._url = url;
  this.url = url; // public version; overridden by physical connections
  this._ctx = ctx;
  this._robustId = robustId;
  this._conn = null;
  this._stayClosed = false;

  // Initialize all event handlers to no-op.
  this.onopen = this.onclose = this.onerror = this.onmessage = function() {};

  // We'll need to carefully maintain the readyState manually.
  this._setReadyState(WebSocket.CONNECTING);
  this._connect(this._timeout);
}

RobustConnection.prototype._setReadyState = function(value) {
  if (typeof(this.readyState) !== "undefined" && this.readyState > value) {
    throw new Error("Invalid readyState transition: " + this.readyState + " to " + value);
  }
  this.readyState = value;
};

RobustConnection.prototype._acceptConn = function(conn) {

  // It's a programmer error to accept a connection while the previous
  // connection is still active...
  assert(!this._conn || this._conn.readyState > WebSocket.OPEN, "_acceptConn called while previous conn was still active");
  // ...or for the connection itself not to be open...
  assert(conn.readyState === WebSocket.OPEN, "_acceptConn called with non-open conn: " + conn.readyState);
  // ...or for the RobustConnection itself to be closed.
  assert(this.readyState === WebSocket.CONNECTING || this.readyState === WebSocket.OPEN, "_acceptConn called while readyState was " + this.readyState);

  this._conn = conn;
  // onopen intentionally not set; if we're here, we're
  // already in the OPEN state.
  this._conn.onclose = this._handleClose.bind(this);
  this._conn.onmessage = this._handleMessage.bind(this);
  this._conn.onerror = this._handleError.bind(this);
  this.protocol = conn.protocol;
  this.extensions = conn.extensions;
  this.url = conn.url;

  if (this.readyState === WebSocket.CONNECTING) {
    // This is our first time getting an open connection!
    // Transition to OPEN and let our clients know.
    this._setReadyState(WebSocket.OPEN);
    if (this.onopen)
      this.onopen(util.createEvent("open"));
  } else {
    log("Connection restored");

    // Otherwise, let our clients know that we've just reconnected.
    this.onreconnect(util.createEvent("reconnect"));
  }
};

RobustConnection.prototype._clearConn = function() {
  if (this._conn) {
    this._conn.onopen = null;
    this._conn.onclose = null;
    this._conn.onerror = null;
    this._conn.onmessage = null;
    this._conn = null;
  }
};

// Call this when we don't have a connection (either we have never
// had one yet, or the last one we had is now closed and removed)
// but we want to get a new one.
RobustConnection.prototype._connect = function(timeoutMillis) {
  assert(!this._conn, "_connect called but _conn is not null");
  assert(this.readyState <= WebSocket.OPEN, "_connect called from wrong readyState");

  // This function can be called repeatedly to get a connection promise.
  // Because it uses promisify_p, a successful resolve of the promise
  // means not only that the connection was created, but also entered
  // the WebSocket.OPEN state.
  let open_p = () => {
    let params = {};
    params[this.readyState === WebSocket.CONNECTING ? "n" : "o"] = this._robustId;
    this._ctx.params[this.readyState === WebSocket.CONNECTING ? "n" : "o"] = this._robustId;
    let url = pathParams.addPathParams(this._url, params);

    let promise = util.promise();
    this._factory(url, this._ctx, function(err, conn) {
      if (err) {
        promise(false, [err]);
        return;
      }

      promisify_p(conn).then(
        function() { promise(true, arguments); },
        function() {
          setTimeout(function() {
            promise(false, arguments);
          }, 500);
        }
      ).done();
    });
    return promise;
  };

  let expires = this.readyState !== WebSocket.OPEN ? 0 : Date.now() + timeoutMillis;

  let progressCallbacks = new EventEmitter();
  if (this.readyState === WebSocket.OPEN) {
    progressCallbacks.on("schedule", delay => { this._ctx.emit("reconnect-schedule", delay); });
    progressCallbacks.on("attempt", _ => { this._ctx.emit("reconnect-attempt"); });
    progressCallbacks.on("success", _ => { this._ctx.emit("reconnect-success"); });
    progressCallbacks.on("failure", _ => { this._ctx.emit("reconnect-failure"); });
  }

  util.retryPromise_p(open_p, util.createNiceBackoffDelayFunc(), expires, progressCallbacks).then(
    (conn) => {

      assert(!this._conn, "Connection promise fulfilled, but _conn was not null!");

      // If RobustConnection.close() was called in the
      // meantime, close the new conn and bail out.
      if (this.readyState === WebSocket.CLOSED) {
        conn.close();
        return;
      }

      this._acceptConn(conn);
      conn.resume();
    },
    (err) => {
      log(err);

      assert(!this._conn, "Connection promise rejected, but _conn was not null!");

      // If RobustConnection.close() was called in the
      // meantime, just get out of here.
      if (this.readyState === WebSocket.CLOSED) {
        return;
      }

      // If we're still waiting for the initial connection, we
      // want to raise an additional error event. (Is this
      // really necessary? I'm just guessing.)
      try {
        if (this.readyState === WebSocket.CONNECTING) {
          this.onerror(util.createEvent("error"));
        }
      } finally {
        // Whether onerror succeeds or not, we always want to close.
        // Note that code 1006 can't be passed to WebSocket.close (at
        // least on my Chrome install) but in this case we know for
        // sure there's no WebSocket to call close on--the connection
        // attempt failed, so this code will just be used to make an
        // event.
        this.close(1006, "", false);
      }
    }
  ).done();
};

RobustConnection.prototype._handleClose = function(e) {
  this._clearConn();
  // Use 4567 for interactive debugging purposes to trigger reconnect
  if ((e.code !== 4567) && e.wasClean || this._stayClosed) {
    // Apparently this closure was on purpose; don't try to reconnect
    this._setReadyState(WebSocket.CLOSED);
    this.onclose(e);
    this._ctx.emit("disconnect");
  } else {
    log("Disconnect detected; attempting reconnect");
    this.ondisconnect(util.createEvent("disconnect"));
    this._connect(this._timeout);
  }
};

// Event callback for this._conn.onmessage. Delegates to public
// member. We have to add this level of indirection to allow
// the value of this.onmessage to change over time.
RobustConnection.prototype._handleMessage = function(e) {
  if (this.onmessage)
    this.onmessage(e);
};
// Event callback for this._conn.onerror. Delegates to public
// member. We have to add this level of indirection to allow
// the value of this.onerror to change over time.
RobustConnection.prototype._handleError = function(e) {
  if (this.onerror)
    this.onerror(e);
};

RobustConnection.prototype.send = function(data) {
  if (this.readyState === WebSocket.CONNECTING) {
    throw new Error("Can't send when connection is in CONNECTING state");
  } else if (this.readyState > WebSocket.OPEN) {
    throw new Error("Connection is already CLOSING or CLOSED");
  } else if (!this._conn) {
    // Previously, we buffered messages that were sent while in this
    // state, so we could send them if/when a reconnection succeeded.
    // But with BufferedResendConnection, such a mechanism is not only
    // unnecessary, but dangerous; buffering messages can only be
    // done safely by BufferedResendConnection, not by us, because
    // only BRC retains knowledge about the proper message order, and
    // what messages have actually been received by the other side.
    throw new Error("Can't send when connection is disconnected");
  }

  this._conn.send(data);
};

RobustConnection.prototype.close = function(code, reason) {
  if (this.readyState === WebSocket.CLOSED) {
    return;
  }

  // Be careful!!

  if (this._conn) {
    // If a connection is currently active, we want to call close on
    // it and, for the most part, let nature take its course.

    // May throw, if code or reason are invalid. I'm assuming when
    // that happens, the conn isn't actually closed, so we need to
    // undo any side effects we have done before calling close().
    try {
      this._stayClosed = true; // Make sure not to reconnect
      this._conn.close(code, reason);
    } catch(e) {
      // Undo the setting of the flag.
      this._stayClosed = false;
      throw e;
    }

    // If _conn.close() hasn't triggered the _handleClose handler yet
    // (and I don't think it will have) then we need to mark ourselves
    // as CLOSING.
    this._setReadyState(Math.max(this.readyState, WebSocket.CLOSING));

  } else {

    // There's no active connection. Just immediately put us in closed
    // state and raise the event.
    this._setReadyState(WebSocket.CLOSED);
    if (this.onclose) {
      this.onclose(util.createEvent("close", {
        currentTarget: this, target: this, srcElement: this,
        code: code, reason: reason,
        wasClean: false
      }));
    }
  }
};


function BufferedResendConnection(conn) {
  BaseConnectionDecorator.call(this, conn);
  assert(this._conn);

  // This connection decorator is tightly coupled to RobustConnection
  assert(conn.constructor === RobustConnection);

  this._messageBuffer = new MessageBuffer();
  this._messageReceiver = new MessageReceiver();
  this._messageReceiver.onacktimeout = e => {
    let msgId = e.messageId;
    if (this._conn.readyState === WebSocket.OPEN && !this._disconnected) {
      this._conn.send(this._messageReceiver.ACK());
    }
  };

  this._disconnected = false;

  conn.onopen = this._handleOpen.bind(this);
  conn.onmessage = this._handleMessage.bind(this);
  conn.onerror = this._handleError.bind(this);
  conn.onclose = this._handleClose.bind(this);

  // These two events are specific to RobustConnection. They
  // are used to detect potentially-temporary disruptions,
  // and successful recovery from those disruptions.
  conn.ondisconnect = this._handleDisconnect.bind(this);
  conn.onreconnect = this._handleReconnect.bind(this);
}

inherits(BufferedResendConnection, BaseConnectionDecorator);

BufferedResendConnection.prototype._handleDisconnect = function() {
  this._disconnected = true;
};
BufferedResendConnection.prototype._handleReconnect = function() {

  // Tell the other side where we stopped hearing their messages
  this._conn.send(this._messageReceiver.CONTINUE());

  this._conn.onmessage = (e) => {
    this._disconnected = false;
    this._conn.onmessage = this._handleMessage.bind(this);

    // If this is a proper, robustified connection, before we do
    // anything else we'll get a message indicating the most
    // recent message number seen + 1 (or 0 if none seen yet).
    try {
      let continueId = message_utils.parseCONTINUE(e.data);
      if (continueId === null) {
        throw new Error("The RobustConnection handshake failed, CONTINUE expected");
      } else {
        // continueId represents the first id *not* seen by the server.
        // It might seem unintuitive to make it defined like that
        // rather than the last id seen by the server, but this allows
        // us to easily represent the case where the server has not
        // seen any messages (0) and also makes the iterating code here
        // a little cleaner.
        debug("Discard and continue from message " + continueId);
        // Note: discard can throw
        this._messageBuffer.discard(continueId);
        // Note: getMessageFrom can throw
        let msgs = this._messageBuffer.getMessagesFrom(continueId);
        if (msgs.length > 0)
          debug(msgs.length + " messages were dropped; resending");
        msgs.forEach(msg => {
          // This msg is already formatted by MessageBuffer (tagged with id)
          this._conn.send(msg);
        });
      }
    } catch (e) {
      log("Error: RobustConnection handshake error: " + e);
      log(e.stack);
      this.close(3007, "RobustConnection handshake error: " + e);
    }
  };
};

BufferedResendConnection.prototype._handleMessage = function(e) {
  // At any time we can receive an ACK from the server that tells us
  // it's safe to discard existing messages.
  try {
    let ackResult = this._messageBuffer.handleACK(e.data);
    // If the message wasn't an ACK at all, ackResult is a negative num.
    if (ackResult >= 0) {
      debug(ackResult + " message(s) discarded from buffer");
      return;
    }
  } catch (e) {
    log("Error: ACK handling failed: " + e);
    log(e.stack);
    this.close(3008, "ACK handling failed: " + e);
    return;
  }

  e.data = this._messageReceiver.receive(e.data);

  if (this.onmessage) {
    this.onmessage.apply(this, arguments);
  }
};

BufferedResendConnection.prototype.send = function(data) {
  if (typeof(data) === "undefined" || data === null) {
    throw new Error("data argument must not be undefined or null");
  }

  // Write to the message buffer, and also save the return value which
  // is the message prepended with the id. This is what a compatible
  // server will expect to see.
  data = this._messageBuffer.write(data);

  // If not disconnected, attempt to send; otherwise, it's enough
  // that we wrote it to the buffer.
  if (!this._disconnected)
    this._conn.send(data);
};
