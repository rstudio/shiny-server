(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";

// No ES6 allowed in this directory!

var message_utils = require("./message-utils");

module.exports = MessageBuffer;
function MessageBuffer() {
  this._messages = [];
  this._startIndex = 0;
  this._messageId = 0;
}

MessageBuffer.prototype.write = function (msg) {
  msg = message_utils.formatId(this._messageId++) + "#" + msg;
  this._messages.push(msg);
  return msg;
};

MessageBuffer.prototype.handleACK = function (msg) {
  var ackId = message_utils.parseACK(msg);
  if (ackId === null) {
    return -1;
  }
  return this.discard(ackId);
};

// Returns the number of messages that were actually
// discarded.
//
// Can throw an error, if nextId is outside of the valid range.
MessageBuffer.prototype.discard = function (nextId) {
  // The message ID they send is the first id *not* seen by
  // their side (and not the last id seen by them). This is
  // not intuitive, but it makes it possible to indicate
  // no messages seen ("0") and makes the indexing math a
  // bit cleaner as well.
  var keepIdx = nextId - this._startIndex;
  if (keepIdx < 0) {
    throw new Error("Discard position id too small");
  }
  if (keepIdx > this._messages.length) {
    throw new Error("Discard position id too big");
  }
  this._messages = this._messages.slice(keepIdx);
  this._startIndex = nextId;
  return keepIdx; // equal to the number of messages we dropped
};

MessageBuffer.prototype.nextId = function () {
  return this._messageId;
};

// Can throw an error, if startId is outside of the valid range.
MessageBuffer.prototype.getMessagesFrom = function (startId) {
  var from = startId - this._startIndex;
  if (from < 0) {
    throw new Error("Message buffer underrun detected");
  }
  if (from > this._messages.length) {
    throw new Error("Message id larger than expected");
  }

  return this._messages.slice(from);
};

},{"./message-utils":3}],2:[function(require,module,exports){
"use strict";

// No ES6 allowed in this directory!

var message_utils = require("./message-utils");

module.exports = MessageReceiver;
function MessageReceiver(ackTimeout) {
  this._pendingMsgId = 0;
  this._ackTimer = null;
  this._ackTimeout = ackTimeout || 2000;

  // This should be set by clients
  this.onacktimeout = function (e) {};
}

MessageReceiver.parseId = parseId;
function parseId(str) {
  return parseInt(str, 16);
}

MessageReceiver.prototype.receive = function (msg) {
  var self = this;

  var result = message_utils.parseTag(msg);
  if (!result) {
    throw new Error("Invalid robust-message, no msg-id found");
  }

  this._pendingMsgId = result.id;

  if (!this._ackTimer) {
    this._ackTimer = setTimeout(function () {
      self._ackTimer = null;
      self.onacktimeout({ messageId: self._pendingMessageId });
    }, this._ackTimeout);
  }

  return result.data;
};

MessageReceiver.prototype.nextId = function () {
  return this._pendingMsgId;
};

MessageReceiver.prototype.ACK = function () {
  return "ACK " + message_utils.formatId(this._pendingMsgId);
};

MessageReceiver.prototype.CONTINUE = function () {
  return "CONTINUE " + message_utils.formatId(this._pendingMsgId);
};

},{"./message-utils":3}],3:[function(require,module,exports){
"use strict";

exports.formatId = formatId;
function formatId(id) {
  return id.toString(16).toUpperCase();
};

exports.parseId = parseId;
function parseId(str) {
  return parseInt(str, 16);
};

exports.parseTag = function (val) {
  var m = /^([\dA-F]+)#(.*)$/.exec(val);
  if (!m) {
    return null;
  }

  return {
    id: parseId(m[1]),
    data: m[2]
  };
};

exports.parseCONTINUE = function (val) {
  var m = /^CONTINUE ([\dA-F]+)$/.exec(val);
  if (!m) {
    return null;
  }
  return parseId(m[1]);
};

exports.parseACK = function (val) {
  var m = /^ACK ([\dA-F]+)$/.exec(val);
  if (!m) {
    return null;
  }
  return parseId(m[1]);
};

},{}],4:[function(require,module,exports){
"use strict";

module.exports = function (msg) {
  if (typeof console !== "undefined" && !module.exports.suppress) {
    console.log(new Date() + " [DBG]: " + msg);
  }
};

module.exports.suppress = false;

},{}],5:[function(require,module,exports){
"use strict";

module.exports = BaseConnectionDecorator;

function BaseConnectionDecorator(conn) {
  this._conn = conn;
  conn.onopen = this._handleOpen.bind(this);
  conn.onmessage = this._handleMessage.bind(this);
  conn.onerror = this._handleError.bind(this);
  conn.onclose = this._handleClose.bind(this);
}

BaseConnectionDecorator.prototype.send = function (data) {
  this._conn.send(data);
};

BaseConnectionDecorator.prototype.close = function () {
  return this._conn.close();
};

BaseConnectionDecorator.prototype._handleOpen = function () {
  if (this.onopen) {
    this.onopen.apply(this, arguments);
  }
};
BaseConnectionDecorator.prototype._handleMessage = function () {
  if (this.onmessage) {
    this.onmessage.apply(this, arguments);
  }
};
BaseConnectionDecorator.prototype._handleError = function () {
  if (this.onerror) {
    this.onerror.apply(this, arguments);
  }
};
BaseConnectionDecorator.prototype._handleClose = function () {
  if (this.onclose) {
    this.onclose.apply(this, arguments);
  }
};

Object.defineProperty(BaseConnectionDecorator.prototype, "readyState", {
  get: function readyState() {
    return this._conn.readyState;
  }
});
Object.defineProperty(BaseConnectionDecorator.prototype, "url", {
  get: function readyState() {
    return this._conn.url;
  }
});
Object.defineProperty(BaseConnectionDecorator.prototype, "protocol", {
  get: function readyState() {
    return this._conn.protocol;
  }
});
Object.defineProperty(BaseConnectionDecorator.prototype, "extensions", {
  get: function readyState() {
    return this._conn.extensions;
  }
});

},{}],6:[function(require,module,exports){
"use strict";

var MultiplexClient = require("../multiplex-client");

// The job of this decorator is to wrap the underlying
// connection with our Multiplexing protocol, designed
// to allow multiple iframes to share the same connection
// on the client but proxy out to multiple sessions on
// the server. This decorator provides the "primary"
// multiplex channel, i.e. the one from the outermost
// webpage/frame.
//
// * Writes to ctx: multiplexClient (MultiplexClient)
// * Reads from ctx: nothing
exports.decorate = function (factory, options) {
  return function (url, ctx, callback) {
    return factory(url, ctx, function (err, conn) {
      if (err) {
        callback(err);
        return;
      }

      try {
        var client = new MultiplexClient(conn);
        ctx.multiplexClient = client;
        callback(null, client.open(""));
      } catch (e) {
        callback(e);
      }
    });
  };
};

},{"../multiplex-client":11}],7:[function(require,module,exports){
"use strict";

var assert = require("assert");

var inherits = require("inherits");

var debug = require("../debug");
var log = require("../log");
var util = require("../util");
var WebSocket = require("../websocket");

var BaseConnectionDecorator = require("./base-connection-decorator");
var MessageBuffer = require("../../common/message-buffer");
var MessageReceiver = require("../../common/message-receiver");
var message_utils = require("../../common/message-utils");

function generateId(size) {
  var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  var id = '';
  for (var i = 0; i < size; i++) {
    var rnum = Math.floor(Math.random() * chars.length);
    id += chars.substring(rnum, rnum + 1);
  }
  return id;
};

// The job of this decorator is to serve as a "logical"
// connection that can survive the death of a "physical"
// connection, and restore the connection.
//
// * Reads from options: reconnectTimeout (in millis; <0 to disable)
// * Writes to ctx: nothing
// * Reads from ctx: nothing
exports.decorate = function (factory, options) {
  // Returns a connection promise
  return function (url, ctx, callback) {

    // The robustId is an id that will be shared by all
    // physical connections belonging to this logical
    // connection. We will include it in the URL.
    var robustId = generateId(18);

    var timeout = options.reconnectTimeout;
    if (typeof timeout === "undefined") {
      timeout = 15000;
    }

    var conn = new RobustConnection(timeout, factory, url, ctx, robustId);
    conn = new BufferedResendConnection(conn);
    callback(null, conn);
  };
};

// Utility function takes a (potentially still CONNECTING)
// connection, and returns a promise. The promise resolves
// successfully if onopen is called, and resolves as an
// error if onerror or onclose is called.
function promisify_p(conn) {

  var promise = util.promise();
  if (conn.readyState === WebSocket.OPEN) {
    promise(true, [conn]);
  } else if (conn.readyState === WebSocket.CLOSING || conn.readyState === WebSocket.CLOSED) {
    promise(false, [new Error("WebSocket was closed")]);
  } else if (conn.readyState === WebSocket.CONNECTING) {
    conn.onopen = function () {
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
    conn.onerror = function (e) {
      conn.onopen = null;
      conn.onclose = null;
      conn.onerror = null;
      promise(false, [new Error("WebSocket errored"), e]);
    };
    conn.onclose = function (e) {
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
  this.onopen = this.onclose = this.onerror = this.onmessage = function () {};

  // We'll need to carefully maintain the readyState manually.
  this._setReadyState(WebSocket.CONNECTING);
  this._connect(this._timeout);
}

RobustConnection.prototype._setReadyState = function (value) {
  if (typeof this.readyState !== "undefined" && this.readyState > value) {
    throw new Error("Invalid readyState transition: " + this.readyState + " to " + value);
  }
  this.readyState = value;
};

RobustConnection.prototype._acceptConn = function (conn) {

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
    if (this.onopen) this.onopen(util.createEvent("open"));
  } else {
    log("Connection restored");

    // Otherwise, let our clients know that we've just reconnected.
    this.onreconnect(util.createEvent("reconnect"));
  }
};

RobustConnection.prototype._clearConn = function () {
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
RobustConnection.prototype._connect = function (timeoutMillis) {
  var _this = this;

  assert(!this._conn, "_connect called but _conn is not null");
  assert(this.readyState <= WebSocket.OPEN, "_connect called from wrong readyState");

  // This function can be called repeatedly to get a connection promise.
  // Because it uses promisify_p, a successful resolve of the promise
  // means not only that the connection was created, but also entered
  // the WebSocket.OPEN state.
  var open_p = function open_p() {
    var params = {};
    params[_this.readyState === WebSocket.CONNECTING ? "n" : "o"] = _this._robustId;
    var url = util.addPathParams(_this._url, params);

    var promise = util.promise();
    _this._factory(url, _this._ctx, function (err, conn) {
      if (err) {
        promise(false, [err]);
        return;
      }

      promisify_p(conn).then(function () {
        promise(true, arguments);
      }, function () {
        promise(false, arguments);
      }).done();
    });
    return promise;
  };

  var expires = this.readyState !== WebSocket.OPEN ? 0 : Date.now() + timeoutMillis;

  util.retryPromise_p(open_p, util.createNiceBackoffDelayFunc(), expires).then(function (conn) {

    assert(!_this._conn, "Connection promise fulfilled, but _conn was not null!");

    // If RobustConnection.close() was called in the
    // meantime, close the new conn and bail out.
    if (_this.readyState === WebSocket.CLOSED) {
      conn.close();
      return;
    }

    _this._acceptConn(conn);
    conn.resume();
  }, function (err) {
    log(err);

    assert(!_this._conn, "Connection promise rejected, but _conn was not null!");

    // If RobustConnection.close() was called in the
    // meantime, just get out of here.
    if (_this.readyState === WebSocket.CLOSED) {
      return;
    }

    // If we're still waiting for the initial connection, we
    // want to raise an additional error event. (Is this
    // really necessary? I'm just guessing.)
    try {
      if (_this.readyState === WebSocket.CONNECTING) {
        _this.onerror(util.createEvent("error"));
      }
    } finally {
      // Whether onerror succeeds or not, we always want to close.
      // Note that code 1006 can't be passed to WebSocket.close (at
      // least on my Chrome install) but in this case we know for
      // sure there's no WebSocket to call close on--the connection
      // attempt failed, so this code will just be used to make an
      // event.
      _this.close(1006, "", false);
    }
  }).done();
};

RobustConnection.prototype._handleClose = function (e) {
  this._clearConn();
  // Use 4567 for interactive debugging purposes to trigger reconnect
  if (e.code !== 4567 && e.wasClean || this._stayClosed) {
    // Apparently this closure was on purpose; don't try to reconnect
    this._setReadyState(WebSocket.CLOSED);
    this.onclose(e);
  } else {
    log("Disconnect detected; attempting reconnect");
    this.ondisconnect(util.createEvent("disconnect"));
    this._connect(this._timeout);
  }
};

// Event callback for this._conn.onmessage. Delegates to public
// member. We have to add this level of indirection to allow
// the value of this.onmessage to change over time.
RobustConnection.prototype._handleMessage = function (e) {
  if (this.onmessage) this.onmessage(e);
};
// Event callback for this._conn.onerror. Delegates to public
// member. We have to add this level of indirection to allow
// the value of this.onerror to change over time.
RobustConnection.prototype._handleError = function (e) {
  if (this.onerror) this.onerror(e);
};

RobustConnection.prototype.send = function (data) {
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

RobustConnection.prototype.close = function (code, reason) {
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
    } catch (e) {
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
  var _this2 = this;

  BaseConnectionDecorator.call(this, conn);
  assert(this._conn);

  // This connection decorator is tightly coupled to RobustConnection
  assert(conn.constructor === RobustConnection);

  this._messageBuffer = new MessageBuffer();
  this._messageReceiver = new MessageReceiver();
  this._messageReceiver.onacktimeout = function (e) {
    var msgId = e.messageId;
    if (_this2._conn.readyState === WebSocket.OPEN) {
      _this2._conn.send(_this2._messageReceiver.ACK());
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

BufferedResendConnection.prototype._handleDisconnect = function () {
  this._disconnected = true;
};
BufferedResendConnection.prototype._handleReconnect = function () {
  var _this3 = this;

  // Tell the other side where we stopped hearing their messages
  this._conn.send(this._messageReceiver.CONTINUE());

  this._conn.onmessage = function (e) {
    _this3._disconnected = false;
    _this3._conn.onmessage = _this3._handleMessage.bind(_this3);

    // If this is a proper, robustified connection, before we do
    // anything else we'll get a message indicating the most
    // recent message number seen + 1 (or 0 if none seen yet).
    try {
      var continueId = message_utils.parseCONTINUE(e.data);
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
        _this3._messageBuffer.discard(continueId);
        // Note: getMessageFrom can throw
        var msgs = _this3._messageBuffer.getMessagesFrom(continueId);
        if (msgs.length > 0) debug(msgs.length + " messages were dropped; resending");
        msgs.forEach(function (msg) {
          // This msg is already formatted by MessageBuffer (tagged with id)
          _this3._conn.send(msg);
        });
      }
    } catch (e) {
      log("Error: RobustConnection handshake error: " + e);
      log(e.stack);
      _this3.close(3007, "RobustConnection handshake error: " + e);
    }
  };
};

BufferedResendConnection.prototype._handleMessage = function (e) {
  // At any time we can receive an ACK from the server that tells us
  // it's safe to discard existing messages.
  try {
    var ackResult = this._messageBuffer.handleACK(e.data);
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

BufferedResendConnection.prototype.send = function (data) {
  if (typeof data === "undefined" || data === null) {
    throw new Error("data argument must not be undefined or null");
  }

  // Write to the message buffer, and also save the return value which
  // is the message prepended with the id. This is what a compatible
  // server will expect to see.
  data = this._messageBuffer.write(data);

  // If not disconnected, attempt to send; otherwise, it's enough
  // that we wrote it to the buffer.
  if (!this._disconnected) this._conn.send(data);
};

},{"../../common/message-buffer":1,"../../common/message-receiver":2,"../../common/message-utils":3,"../debug":4,"../log":9,"../util":14,"../websocket":15,"./base-connection-decorator":5,"assert":16,"inherits":21}],8:[function(require,module,exports){
"use strict";

var util = require('../util');

// The job of this decorator is to request a token from
// the server, and append that to the URL.
//
// * Writes to ctx: nothing
// * Reads from ctx: nothing
exports.decorate = function (factory, options) {
  return function (url, ctx, callback) {
    if (!exports.ajax) {
      throw new Error("No HTTP transport was provided");
    }

    var xhr = exports.ajax("__token__", {
      type: "GET",
      cache: false,
      dataType: "text",
      success: function success(data, textStatus) {
        var newUrl = util.addPathParams(url, { "t": data });
        factory(newUrl, ctx, callback);
      },
      error: function error(jqXHR, textStatus, errorThrown) {
        callback(errorThrown);
      }
    });
  };
};

// Override this to mock.
exports.ajax = null;
if (typeof jQuery !== "undefined") {
  exports.ajax = jQuery.ajax;
}

},{"../util":14}],9:[function(require,module,exports){
"use strict";

module.exports = function (msg) {
  if (typeof console !== "undefined" && !module.exports.suppress) {
    console.log(new Date() + " [INF]: " + msg);
  }
};

module.exports.suppress = false;

},{}],10:[function(require,module,exports){
(function (global){
'use strict';

var util = require('./util');
var token = require('./decorators/token');
//var subapp = require('./subapp');
//var extendsession = require('./extendsession');
var reconnect = require('./decorators/reconnect');
var multiplex = require('./decorators/multiplex');
var sockjs = require("./sockjs");
var PromisedConnection = require("./promised-connection");

/*
Connection factories:
- SockJS (reconnect-aware)
- Subapp

Connection factory decorators:
- WorkerId maintainer (reconnect-aware)
- Token adder
- Reconnector (requires underlying connections to be reconnect-aware)
- MultiplexClient

SSOS config:
  Primary app:
    SockJS + Reconnector + MultiplexClient
  Subapp:
    Subapp

SSP/RSC config:
  Primary app:
    SockJS + WorkerId + Token + Reconnector + MultiplexClient
  Subapp:
    Subapp
*/

/**
 * options = {
 *   reconnect: false
 *   debugging: false
 *   extendsession: false
 * }
 *
 */
function initSession(shiny, options) {
  var factory;

  if (false && subapp.isSubApp()) {
    // TODO
  } else {
      // Not a subapp
      // if (options.extendsession) {
      //   extendsession.init();
      // }

      factory = sockjs.createFactory(options);
      if (options.reconnect) {
        factory = reconnect.decorate(factory, options);
      }
      factory = multiplex.decorate(factory);
    }

  // Register the connection with Shiny.createSocket, etc.
  shiny.createSocket = function () {
    var url = location.protocol + "//" + location.host + location.pathname.replace(/\\$/, "");
    url += "/__sockjs__/";

    var pc = new PromisedConnection();
    factory(url, {}, pc.resolve.bind(pc));
    return pc;
  };
}

global.preShinyInit = function (options) {
  initSession(global.Shiny, options);
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./decorators/multiplex":6,"./decorators/reconnect":7,"./decorators/token":8,"./promised-connection":12,"./sockjs":13,"./util":14}],11:[function(require,module,exports){
(function (global){
'use strict';

var log = require('./log');
var debug = require('./debug');

// MultiplexClient sits on top of a SockJS connection and lets the caller
// open logical SockJS connections (channels). The SockJS connection is
// closed when all of the channels close. This means you can't start with
// zero channels, open a channel, close that channel, and then open
// another channel.
module.exports = MultiplexClient;

function MultiplexClient(conn) {
  var _this = this;

  // The underlying SockJS connection. At this point it is not likely to
  // be opened yet.
  this._conn = conn;
  // A table of all active channels.
  // Key: id, value: MultiplexClientChannel
  this._channels = {};
  this._channelCount = 0;
  // ID to use for the next channel that is opened
  this._nextId = 0;
  // Channels that need to be opened when the SockJS connection's open
  // event is received
  this._pendingChannels = [];
  // A list of functions that fire when our connection goes away.
  this.onclose = [];

  this._conn.onopen = function () {
    log("Connection opened. " + global.location.href);
    var channel;
    while (channel = _this._pendingChannels.shift()) {
      // Be sure to check readyState so we don't open connections for
      // channels that were closed before they finished opening
      if (channel.readyState === 0) {
        channel._open();
      } else {
        debug("NOT opening channel " + channel.id);
      }
    }
  };
  this._conn.onclose = function (e) {
    log("Connection closed. Info: " + JSON.stringify(e));
    debug("SockJS connection closed");
    // If the SockJS connection is terminated from the other end (or due
    // to loss of connectivity or whatever) then we can notify all the
    // active channels that they are closed too.
    for (var key in _this._channels) {
      if (_this._channels.hasOwnProperty(key)) {
        _this._channels[key]._destroy(e);
      }
    }
    for (var i = 0; i < _this.onclose.length; i++) {
      _this.onclose[i]();
    }
  };
  this._conn.onmessage = function (e) {
    var msg = parseMultiplexData(e.data);
    if (!msg) {
      log("Invalid multiplex packet received from server");
      _this._conn.close();
      return;
    }
    var id = msg.id;
    var method = msg.method;
    var payload = msg.payload;
    var channel = _this._channels[id];
    if (!channel) {
      log("Multiplex channel " + id + " not found");
      return;
    }
    if (method === "c") {
      // If we're closing, we want to close everything, not just a subapp.
      // So don't send to a single channel.
      _this._conn.close();
    } else if (method === "m") {
      channel.onmessage({ data: payload });
    }
  };
}
MultiplexClient.prototype.open = function (url) {
  var channel = new MultiplexClientChannel(this, this._nextId++ + "", this._conn, url);
  this._channels[channel.id] = channel;
  this._channelCount++;

  switch (this._conn.readyState) {
    case 0:
      this._pendingChannels.push(channel);
      break;
    case 1:
      setTimeout(function () {
        channel._open();
      }, 0);
      break;
    default:
      setTimeout(function () {
        channel.close();
      }, 0);
      break;
  }
  return channel;
};
MultiplexClient.prototype.removeChannel = function (id) {
  delete this._channels[id];
  this._channelCount--;
  debug("Removed channel " + id + ", " + this._channelCount + " left");
  if (this._channelCount === 0 && this._conn.readyState < 2) {
    debug("Closing SockJS connection since no channels are left");
    this._conn.close();
  }
};

function MultiplexClientChannel(owner, id, conn, url) {
  this._owner = owner;
  this.id = id;
  this.conn = conn;
  this.url = url;
  this.readyState = 0;
  this.onopen = function () {};
  this.onclose = function () {};
  this.onmessage = function () {};
}
MultiplexClientChannel.prototype._open = function (parentURL) {
  debug("Open channel " + this.id);
  this.readyState = 1;

  //var relURL = getRelativePath(parentURL, this.url)

  this.conn.send(formatOpenEvent(this.id, this.url));
  if (this.onopen) this.onopen();
};
MultiplexClientChannel.prototype.send = function (data) {
  if (this.readyState === 0) throw new Error("Invalid state: can't send when readyState is 0");
  if (this.readyState === 1) this.conn.send(formatMessage(this.id, data));
};
MultiplexClientChannel.prototype.close = function (code, reason) {
  if (this.readyState >= 2) return;
  debug("Close channel " + this.id);
  if (this.conn.readyState === 1) {
    // Is the underlying connection open? Send a close message.
    this.conn.send(formatCloseEvent(this.id, code, reason));
  }
  this._destroy({ code: code, reason: reason, wasClean: true });
};
// Internal version of close that doesn't notify the server
MultiplexClientChannel.prototype._destroy = function (e) {
  var _this2 = this;

  // If we haven't already, invoke onclose handler.
  if (this.readyState !== 3) {
    this.readyState = 3;
    debug("Channel " + this.id + " is closed");
    setTimeout(function () {
      _this2._owner.removeChannel(_this2.id);
      if (_this2.onclose) _this2.onclose(e);
    }, 0);
  }
};

function formatMessage(id, message) {
  return id + '|m|' + message;
}
function formatOpenEvent(id, url) {
  return id + '|o|' + url;
}
function formatCloseEvent(id, code, reason) {
  return id + '|c|' + JSON.stringify({ code: code, reason: reason });
}
function parseMultiplexData(msg) {
  try {
    var m = /^(\d+)\|(m|o|c)\|([\s\S]*)$/m.exec(msg);
    if (!m) return null;
    msg = {
      id: m[1],
      method: m[2],
      payload: m[3]
    };

    switch (msg.method) {
      case 'm':
        break;
      case 'o':
        if (msg.payload.length === 0) return null;
        break;
      case 'c':
        try {
          msg.payload = JSON.parse(msg.payload);
        } catch (e) {
          return null;
        }
        break;
      default:
        return null;
    }

    return msg;
  } catch (e) {
    logger.debug('Error parsing multiplex data: ' + e);
    return null;
  }
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./debug":4,"./log":9}],12:[function(require,module,exports){
"use strict";

var WebSocket = require("./websocket");

module.exports = PromisedConnection;
function PromisedConnection() {
  this._conn = null;
  this._closed = false;
}

PromisedConnection.prototype.resolve = function (err, conn) {
  var _this = this;

  if (err) {
    this._closed = true;
    // TODO: raise onerror
    // TODO: raise onclose
  }

  this._conn = conn;
  if (this._closed) {
    this._conn.close.apply(this._conn, this._closed);
  } else {
    this._conn.onclose = function (evt) {
      _this.onclose(evt);
    };
    this._conn.onopen = function (evt) {
      _this.onopen(evt);
    };
    this._conn.onmessage = function (evt) {
      _this.onmessage(evt);
    };
    this._conn.onerror = function (evt) {
      _this.onerror(evt);
    };
  }
};

PromisedConnection.prototype.close = function (code, reason) {
  var _this2 = this;

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
    setTimeout(function () {
      if (_this2.onclose) {
        var evt = util.createEvent("close", {
          currentTarget: _this2,
          target: _this2,
          srcElement: _this2,
          code: code || 1005,
          reason: reason || "",
          wasClean: true
        });
        _this2.onclose(evt);
      }
    }, 0);
  }
};

PromisedConnection.prototype.send = function (data) {
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
PromisedConnection.prototype._getConnProperty = function (prop, ifPending, ifFailed) {
  if (!this._conn && this._closed) {
    // Failure
    return ifFailed;
  } else if (this._conn) {
    // Success
    return this._conn[prop];
  } else {
    // this._connPromise() === undefined
    return ifPending;
  }
};

// Proxy some properties

Object.defineProperty(PromisedConnection.prototype, "readyState", {
  get: function readyState() {
    if (this._closed) return WebSocket.CLOSED;else return this._getConnProperty("readyState", WebSocket.CONNECTING, WebSocket.CLOSED);
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

},{"./websocket":15}],13:[function(require,module,exports){
(function (global){
"use strict";

var util = require("./util");

var log = require("./log");

exports.createFactory = function (options) {
  return function (url, context, callback) {
    if (!callback) throw new Error("callback is required");

    var conn = new SockJS(url, null, options);

    global.__shinyserverdebug__ = {
      interrupt: function interrupt() {
        log("OK, we'll silently drop messages starting now.");
        conn.send = function (data) {
          log("Dropping message " + data);
        };
        conn.onmessage = function (e) {
          log("Ignoring message " + e.data);
        };
      },
      disconnect: function disconnect() {
        log("OK, we'll simulate a disconnection.");
        // 4567 is magic code number that tells the reconnect
        // decorator to try reconnecting, which we normally
        // only do on !wasClean disconnects.
        conn.close(4567);
      }
    };

    callback(null, conn);
  };
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./log":9,"./util":14}],14:[function(require,module,exports){
(function (global){
"use strict";

var pinkySwear = require("pinkyswear");

exports.addPathParams = function (url, params) {
  var pathFragment = "";
  for (var key in params) {
    if (params.hasOwnProperty(key)) {
      if (!/^\w*$/.test(key) || !/^\w*$/.test(params[key])) {
        throw new Error("util.addPathParams doesn't implement escaping");
      }
      pathFragment += "/" + key + "=" + params[key];
    }
  }
  return url.replace(/\/?(\?|$)/, pathFragment + "$1");
};

exports.createNiceBackoffDelayFunc = function () {
  // delays, in seconds; recycle the last value as needed
  var niceBackoff = [0, 1, 2, 3, 5];
  var pos = -1;
  return function () {
    pos = Math.min(++pos, niceBackoff.length - 1);
    return niceBackoff[pos] * 1000;
  };
};

// Call a function that returns a promise one or more times, until
// it either returns successfully, or time expires. Use a configurable
// delay in between attempts.
exports.retryPromise_p = function (create_p, delayFunc, expiration) {
  var promise = exports.promise();

  var delay = delayFunc();
  // Don't let the delay exceed the remaining time til expiration.
  delay = Math.min(delay, expiration - Date.now());
  // But in no case should the delay be less than zero, either.
  delay = Math.max(0, delay);

  setTimeout(function () {
    create_p().then(function (value) {
      promise(true, [value]);
    }, function (err) {
      if (Date.now() >= expiration) {
        promise(false, [err]);
      } else {
        // Recurse. pinkySwear doesn't give us a way to easily
        // resolve a promise with another promise, so we have to
        // do it manually.
        exports.retryPromise_p(create_p, delayFunc, expiration).then(function () {
          promise(true, arguments);
        }, function () {
          promise(false, arguments);
        }).done();
      }
    }).done();
  }, delay);

  return promise;
};

exports.createEvent = function (type, props) {
  if (global.document) {
    return new Event(type, props);
  } else if (props) {
    props.type = type;
    return props;
  } else {
    return { type: type };
  }
};

function addDone(prom) {
  prom.done = function () {
    prom.then(null, function (err) {
      console.log("Unhandled promise error: " + err);
      console.log(err.stack);
    });
  };
  return prom;
}
exports.promise = function () {
  return pinkySwear(addDone);
};

exports.PauseConnection = PauseConnection;
function PauseConnection(conn) {
  this._conn = conn;
  this._paused = true;
  this._events = [];
  this._timeout = null;

  var pauseConnection = this;
  ["onopen", "onmessage", "onerror", "onclose"].forEach(function (evt) {
    conn[evt] = function () {
      if (pauseConnection._paused) {
        pauseConnection._events.push({ event: evt, args: arguments });
      } else {
        pauseConnection[evt].apply(this, arguments);
      }
    };
  });
}

PauseConnection.prototype.resume = function () {
  var _this = this;

  this._timeout = setTimeout(function () {
    while (_this._events.length) {
      var e = _this._events.shift();
      _this[e.event].apply(_this, e.args);
    }
    _this._paused = false;
  }, 0);
};
PauseConnection.prototype.pause = function () {
  clearTimeout(this._timeout);
  this._paused = true;
};

PauseConnection.prototype.close = function () {
  this._conn.close.apply(this._conn, arguments);
};
PauseConnection.prototype.send = function () {
  this._conn.send.apply(this._conn, arguments);
};

Object.defineProperty(PauseConnection.prototype, "readyState", {
  get: function readyState() {
    return this._conn.readyState;
  }
});
Object.defineProperty(PauseConnection.prototype, "url", {
  get: function readyState() {
    return this._conn.url;
  }
});
Object.defineProperty(PauseConnection.prototype, "protocol", {
  get: function readyState() {
    return this._conn.protocol;
  }
});
Object.defineProperty(PauseConnection.prototype, "extensions", {
  get: function readyState() {
    return this._conn.extensions;
  }
});

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"pinkyswear":22}],15:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
// Constants from WebSocket and SockJS APIs.

var CONNECTING = exports.CONNECTING = 0;
var OPEN = exports.OPEN = 1;
var CLOSING = exports.CLOSING = 2;
var CLOSED = exports.CLOSED = 3;

},{}],16:[function(require,module,exports){
// http://wiki.commonjs.org/wiki/Unit_Testing/1.0
//
// THIS IS NOT TESTED NOR LIKELY TO WORK OUTSIDE V8!
//
// Originally from narwhal.js (http://narwhaljs.org)
// Copyright (c) 2009 Thomas Robinson <280north.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// when used in node, this will actually load the util module we depend on
// versus loading the builtin util module as happens otherwise
// this is a bug in node module loading as far as I am concerned
var util = require('util/');

var pSlice = Array.prototype.slice;
var hasOwn = Object.prototype.hasOwnProperty;

// 1. The assert module provides functions that throw
// AssertionError's when particular conditions are not met. The
// assert module must conform to the following interface.

var assert = module.exports = ok;

// 2. The AssertionError is defined in assert.
// new assert.AssertionError({ message: message,
//                             actual: actual,
//                             expected: expected })

assert.AssertionError = function AssertionError(options) {
  this.name = 'AssertionError';
  this.actual = options.actual;
  this.expected = options.expected;
  this.operator = options.operator;
  if (options.message) {
    this.message = options.message;
    this.generatedMessage = false;
  } else {
    this.message = getMessage(this);
    this.generatedMessage = true;
  }
  var stackStartFunction = options.stackStartFunction || fail;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, stackStartFunction);
  }
  else {
    // non v8 browsers so we can have a stacktrace
    var err = new Error();
    if (err.stack) {
      var out = err.stack;

      // try to strip useless frames
      var fn_name = stackStartFunction.name;
      var idx = out.indexOf('\n' + fn_name);
      if (idx >= 0) {
        // once we have located the function frame
        // we need to strip out everything before it (and its line)
        var next_line = out.indexOf('\n', idx + 1);
        out = out.substring(next_line + 1);
      }

      this.stack = out;
    }
  }
};

// assert.AssertionError instanceof Error
util.inherits(assert.AssertionError, Error);

function replacer(key, value) {
  if (util.isUndefined(value)) {
    return '' + value;
  }
  if (util.isNumber(value) && !isFinite(value)) {
    return value.toString();
  }
  if (util.isFunction(value) || util.isRegExp(value)) {
    return value.toString();
  }
  return value;
}

function truncate(s, n) {
  if (util.isString(s)) {
    return s.length < n ? s : s.slice(0, n);
  } else {
    return s;
  }
}

function getMessage(self) {
  return truncate(JSON.stringify(self.actual, replacer), 128) + ' ' +
         self.operator + ' ' +
         truncate(JSON.stringify(self.expected, replacer), 128);
}

// At present only the three keys mentioned above are used and
// understood by the spec. Implementations or sub modules can pass
// other keys to the AssertionError's constructor - they will be
// ignored.

// 3. All of the following functions must throw an AssertionError
// when a corresponding condition is not met, with a message that
// may be undefined if not provided.  All assertion methods provide
// both the actual and expected values to the assertion error for
// display purposes.

function fail(actual, expected, message, operator, stackStartFunction) {
  throw new assert.AssertionError({
    message: message,
    actual: actual,
    expected: expected,
    operator: operator,
    stackStartFunction: stackStartFunction
  });
}

// EXTENSION! allows for well behaved errors defined elsewhere.
assert.fail = fail;

// 4. Pure assertion tests whether a value is truthy, as determined
// by !!guard.
// assert.ok(guard, message_opt);
// This statement is equivalent to assert.equal(true, !!guard,
// message_opt);. To test strictly for the value true, use
// assert.strictEqual(true, guard, message_opt);.

function ok(value, message) {
  if (!value) fail(value, true, message, '==', assert.ok);
}
assert.ok = ok;

// 5. The equality assertion tests shallow, coercive equality with
// ==.
// assert.equal(actual, expected, message_opt);

assert.equal = function equal(actual, expected, message) {
  if (actual != expected) fail(actual, expected, message, '==', assert.equal);
};

// 6. The non-equality assertion tests for whether two objects are not equal
// with != assert.notEqual(actual, expected, message_opt);

assert.notEqual = function notEqual(actual, expected, message) {
  if (actual == expected) {
    fail(actual, expected, message, '!=', assert.notEqual);
  }
};

// 7. The equivalence assertion tests a deep equality relation.
// assert.deepEqual(actual, expected, message_opt);

assert.deepEqual = function deepEqual(actual, expected, message) {
  if (!_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'deepEqual', assert.deepEqual);
  }
};

function _deepEqual(actual, expected) {
  // 7.1. All identical values are equivalent, as determined by ===.
  if (actual === expected) {
    return true;

  } else if (util.isBuffer(actual) && util.isBuffer(expected)) {
    if (actual.length != expected.length) return false;

    for (var i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) return false;
    }

    return true;

  // 7.2. If the expected value is a Date object, the actual value is
  // equivalent if it is also a Date object that refers to the same time.
  } else if (util.isDate(actual) && util.isDate(expected)) {
    return actual.getTime() === expected.getTime();

  // 7.3 If the expected value is a RegExp object, the actual value is
  // equivalent if it is also a RegExp object with the same source and
  // properties (`global`, `multiline`, `lastIndex`, `ignoreCase`).
  } else if (util.isRegExp(actual) && util.isRegExp(expected)) {
    return actual.source === expected.source &&
           actual.global === expected.global &&
           actual.multiline === expected.multiline &&
           actual.lastIndex === expected.lastIndex &&
           actual.ignoreCase === expected.ignoreCase;

  // 7.4. Other pairs that do not both pass typeof value == 'object',
  // equivalence is determined by ==.
  } else if (!util.isObject(actual) && !util.isObject(expected)) {
    return actual == expected;

  // 7.5 For all other Object pairs, including Array objects, equivalence is
  // determined by having the same number of owned properties (as verified
  // with Object.prototype.hasOwnProperty.call), the same set of keys
  // (although not necessarily the same order), equivalent values for every
  // corresponding key, and an identical 'prototype' property. Note: this
  // accounts for both named and indexed properties on Arrays.
  } else {
    return objEquiv(actual, expected);
  }
}

function isArguments(object) {
  return Object.prototype.toString.call(object) == '[object Arguments]';
}

function objEquiv(a, b) {
  if (util.isNullOrUndefined(a) || util.isNullOrUndefined(b))
    return false;
  // an identical 'prototype' property.
  if (a.prototype !== b.prototype) return false;
  // if one is a primitive, the other must be same
  if (util.isPrimitive(a) || util.isPrimitive(b)) {
    return a === b;
  }
  var aIsArgs = isArguments(a),
      bIsArgs = isArguments(b);
  if ((aIsArgs && !bIsArgs) || (!aIsArgs && bIsArgs))
    return false;
  if (aIsArgs) {
    a = pSlice.call(a);
    b = pSlice.call(b);
    return _deepEqual(a, b);
  }
  var ka = objectKeys(a),
      kb = objectKeys(b),
      key, i;
  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length != kb.length)
    return false;
  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();
  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] != kb[i])
      return false;
  }
  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!_deepEqual(a[key], b[key])) return false;
  }
  return true;
}

// 8. The non-equivalence assertion tests for any deep inequality.
// assert.notDeepEqual(actual, expected, message_opt);

assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
  if (_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'notDeepEqual', assert.notDeepEqual);
  }
};

// 9. The strict equality assertion tests strict equality, as determined by ===.
// assert.strictEqual(actual, expected, message_opt);

assert.strictEqual = function strictEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(actual, expected, message, '===', assert.strictEqual);
  }
};

// 10. The strict non-equality assertion tests for strict inequality, as
// determined by !==.  assert.notStrictEqual(actual, expected, message_opt);

assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (actual === expected) {
    fail(actual, expected, message, '!==', assert.notStrictEqual);
  }
};

function expectedException(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  if (Object.prototype.toString.call(expected) == '[object RegExp]') {
    return expected.test(actual);
  } else if (actual instanceof expected) {
    return true;
  } else if (expected.call({}, actual) === true) {
    return true;
  }

  return false;
}

function _throws(shouldThrow, block, expected, message) {
  var actual;

  if (util.isString(expected)) {
    message = expected;
    expected = null;
  }

  try {
    block();
  } catch (e) {
    actual = e;
  }

  message = (expected && expected.name ? ' (' + expected.name + ').' : '.') +
            (message ? ' ' + message : '.');

  if (shouldThrow && !actual) {
    fail(actual, expected, 'Missing expected exception' + message);
  }

  if (!shouldThrow && expectedException(actual, expected)) {
    fail(actual, expected, 'Got unwanted exception' + message);
  }

  if ((shouldThrow && actual && expected &&
      !expectedException(actual, expected)) || (!shouldThrow && actual)) {
    throw actual;
  }
}

// 11. Expected to throw an error:
// assert.throws(block, Error_opt, message_opt);

assert.throws = function(block, /*optional*/error, /*optional*/message) {
  _throws.apply(this, [true].concat(pSlice.call(arguments)));
};

// EXTENSION! This is annoying to write outside this module.
assert.doesNotThrow = function(block, /*optional*/message) {
  _throws.apply(this, [false].concat(pSlice.call(arguments)));
};

assert.ifError = function(err) { if (err) {throw err;}};

var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    if (hasOwn.call(obj, key)) keys.push(key);
  }
  return keys;
};

},{"util/":20}],17:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],18:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],19:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],20:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":19,"_process":18,"inherits":17}],21:[function(require,module,exports){
arguments[4][17][0].apply(exports,arguments)
},{"dup":17}],22:[function(require,module,exports){
(function (process){
/*
 * PinkySwear.js 2.2.2 - Minimalistic implementation of the Promises/A+ spec
 * 
 * Public Domain. Use, modify and distribute it any way you like. No attribution required.
 *
 * NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.
 *
 * PinkySwear is a very small implementation of the Promises/A+ specification. After compilation with the
 * Google Closure Compiler and gzipping it weighs less than 500 bytes. It is based on the implementation for 
 * Minified.js and should be perfect for embedding. 
 *
 *
 * PinkySwear has just three functions.
 *
 * To create a new promise in pending state, call pinkySwear():
 *         var promise = pinkySwear();
 *
 * The returned object has a Promises/A+ compatible then() implementation:
 *          promise.then(function(value) { alert("Success!"); }, function(value) { alert("Failure!"); });
 *
 *
 * The promise returned by pinkySwear() is a function. To fulfill the promise, call the function with true as first argument and
 * an optional array of values to pass to the then() handler. By putting more than one value in the array, you can pass more than one
 * value to the then() handlers. Here an example to fulfill a promsise, this time with only one argument: 
 *         promise(true, [42]);
 *
 * When the promise has been rejected, call it with false. Again, there may be more than one argument for the then() handler:
 *         promise(true, [6, 6, 6]);
 *         
 * You can obtain the promise's current state by calling the function without arguments. It will be true if fulfilled,
 * false if rejected, and otherwise undefined.
 * 		   var state = promise(); 
 * 
 * https://github.com/timjansen/PinkySwear.js
 */
(function(target) {
	var undef;

	function isFunction(f) {
		return typeof f == 'function';
	}
	function isObject(f) {
		return typeof f == 'object';
	}
	function defer(callback) {
		if (typeof setImmediate != 'undefined')
			setImmediate(callback);
		else if (typeof process != 'undefined' && process['nextTick'])
			process['nextTick'](callback);
		else
			setTimeout(callback, 0);
	}

	target[0][target[1]] = function pinkySwear(extend) {
		var state;           // undefined/null = pending, true = fulfilled, false = rejected
		var values = [];     // an array of values as arguments for the then() handlers
		var deferred = [];   // functions to call when set() is invoked

		var set = function(newState, newValues) {
			if (state == null && newState != null) {
				state = newState;
				values = newValues;
				if (deferred.length)
					defer(function() {
						for (var i = 0; i < deferred.length; i++)
							deferred[i]();
					});
			}
			return state;
		};

		set['then'] = function (onFulfilled, onRejected) {
			var promise2 = pinkySwear(extend);
			var callCallbacks = function() {
	    		try {
	    			var f = (state ? onFulfilled : onRejected);
	    			if (isFunction(f)) {
		   				function resolve(x) {
						    var then, cbCalled = 0;
		   					try {
				   				if (x && (isObject(x) || isFunction(x)) && isFunction(then = x['then'])) {
										if (x === promise2)
											throw new TypeError();
										then['call'](x,
											function() { if (!cbCalled++) resolve.apply(undef,arguments); } ,
											function(value){ if (!cbCalled++) promise2(false,[value]);});
				   				}
				   				else
				   					promise2(true, arguments);
		   					}
		   					catch(e) {
		   						if (!cbCalled++)
		   							promise2(false, [e]);
		   					}
		   				}
		   				resolve(f.apply(undef, values || []));
		   			}
		   			else
		   				promise2(state, values);
				}
				catch (e) {
					promise2(false, [e]);
				}
			};
			if (state != null)
				defer(callCallbacks);
			else
				deferred.push(callCallbacks);
			return promise2;
		};
        if(extend){
            set = extend(set);
        }
		return set;
	};
})(typeof module == 'undefined' ? [window, 'pinkySwear'] : [module, 'exports']);


}).call(this,require('_process'))
},{"_process":18}]},{},[10]);
