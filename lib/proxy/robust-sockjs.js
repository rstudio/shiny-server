/*
 * robust-sockjs.js
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
var util = require('util');
var events = require('events');
var crypto = require('crypto');
var _ = require('underscore');

var MessageBuffer = require("shiny-server-client/common/message-buffer");
var MessageReceiver = require("shiny-server-client/common/message-receiver");
var message_utils = require("shiny-server-client/common/message-utils");
var pathParams = require("shiny-server-client/common/path-params");

var errorcode = require("./errorcode");

// If not a robust URL (missing 'n' or 'o' path param), returns falsy.
function getInfo(conn){
  var params = pathParams.extractParams(conn.url);
  // Look for 'n' (new) or 'o' (open) path param.
  if (params.n) {
    return {id: params.n, existing: false};
  } else if (params.o) {
    return {id: params.o, existing: true};
  } else {
    return false;
  }
}

module.exports = RobustSockJSRegistry;
// @param timeout The number of seconds to retain an abruptly closed connection
//   before passing along its closed and/or end events.
function RobustSockJSRegistry(timeout){
  if (!timeout){
    timeout = 15;
  }
  this._timeout = timeout * 1000;

  this._connections = {};

  var self = this;

  // Handle the incoming connection, either mapping it to an existing session
  // or creating a new Robust connection encapsulation for it.
  //
  // If not a robust connection (getInfo returns falsy), just return the
  // original connection unchanged.
	this.robustify = function(conn){
    var info = getInfo(conn);
    if (!info) {
      // Not robust.
      return conn;
    }
    var id = info.id;
    var existing = info.existing;

    if (id === 'none'){
      return conn;
    }

    // The robust connection object to be returned.
    var robustConn;

    if (self._connections[id]){
      // ID found in table

      if (existing){
        // Reconnecting to an existing session
        logger.debug("Reconnecting to robust connection: " + id);

        self._connections[id].set(conn, true);
        // Return falsey as no further processing/wiring is needed on this connection.
        return;
      } else {
        // Trying to create a new session with a colliding ID
        if (self._connections[id].nascent) {
          logger.debug("Resuming a nascent robust connection: " + id);
          // We'll allow it in this case, because the previous connection never
          // actually received any messages. Probably this is a case where the
          // SockJS transport failed but we didn't realize it.
          self._connections[id].set(conn, false);
          return;
        } else {
          logger.warn("RobustSockJS collision: " + id);
          conn.close(errorcode.BAD_IDENTIFIER,
            "Unable to open connection (RobustSockJS collision)");
          return;
        }
      }
    } else {
      // ID not found in table

      if (existing) {
        // Trying to resume a session which we don't have a record of.
        logger.debug("Disconnecting robust connection because ID wasn't found: " + id);
        conn.close(errorcode.BAD_IDENTIFIER, 'Your session could not be resumed on the server.');
        return;
      } else {
        // Creating a new connection.
        logger.debug("Creating a new robust connection: " + id);
        self._connections[id] = new self.RobustConn(conn, id);
      }
    }

    return self._connections[id];
  };

  // We can't create a wholly new object, or we lose the references we've established
  // on this obj elsewhere.
  this.RobustConn = function(conn, id) {
    // Extend eventEmitter
    events.EventEmitter.call(this);

    var robustConn = this;

    // If the nascent flag is true, it means that this RobustConn has not yet
    // received any data from the client (even though a connection might have
    // been established). If a RobustConn is nascent, it's permitted to call
    // robustConn.set(conn, false), which is more or less the same as saying
    // "pretend the previous/existing (underlying) this._conn didn't exist,
    // just treat this new conn as if it's the first one". This is necessary
    // for SockJS transport failure/fallback to work properly. See the comment
    // on this.set().
    this.nascent = true;

    this._messageBuffer = new MessageBuffer();
    this._messageReceiver = new MessageReceiver();
    this._messageReceiver.onacktimeout = function(e) {
      if (robustConn._conn && robustConn._conn.readyState === 1) {
        // logger.debug("Sending " + robustConn._messageReceiver.ACK());
        robustConn._conn.write(robustConn._messageReceiver.ACK());
      }
    };

    // During reconnection, we don't want to send messages until we have
    // received a CONTINUE message from the client.
    this._expectContinue = false;

    // Make this connection identifiable as a robust connection. We use
    // this to drop connections that ask for robustness but whose apps
    // have reconnect disabled.
    this.robust = true;
    this.close = function(code, reason){
      robustConn._conn.close(code, reason);
    };
    this.write = function(){
      // Records the message in our buffer, and tags it with a message id.
      arguments[0] = this._messageBuffer.write(arguments[0]);

      // Write if this connection is ready.
      if (this._expectContinue) {
        // Do nothing. We've already written to this._messageBuffer; when we
        // receive CONTINUE then we'll send at that point.
      } else if (robustConn._conn.readyState === 1){
        robustConn._conn.write.apply(robustConn._conn, arguments);
      }
    };
    this._readyState = conn.readyState;
    Object.defineProperty(this, "readyState", {
      get: function() {
        // We won't want to actually expose the ready state of the connection,
        // as it may come and go. We want to be in a good ready state until
        // we're shutting down.
        return robustConn._readyState;
      }
    });
    this._withheld = {timer: null, events: []};

    // Swap out the SockJS connection behind this RobustConn.
    //
    // There are three reasons for doing this:
    //
    // - This is a totally new robustConn that has never seen a connection.
    //   Essentially this is just finishing initialization of the robustConn. 
    // - We had an existing conversation going, and the connection was broken,
    //   and now a new connection has arrived. We should clean out the old
    //   connection (if we still have it), and we will send, and expect to
    //   receive, CONTINUE messages on the new connection.
    // - We have an existing connection, but the conversation never actually
    //   got started, and now a new connection has arrived. We see this in the
    //   wild when SockJS connections are mangled by proxies, like nginx with
    //   `proxy_http_version 1.0` (the default) which will kill xhr-streaming.
    //   We think the connection succeeded but our response to the client is
    //   cut short, so they think the conversation never got started. In this
    //   case, we're not going to receive any CONTINUE message and we should
    //   not send one, but act as if an implicit CONTINUE 0 message was
    //   received.
    this.set = function(conn, resume){
      if (robustConn._conn) {
        // Retire old connection

        // Restore the original emit method so we don't see the bubbled
        // close/end events on our RobustConn.
        robustConn._conn.emit = robustConn._conn._oldEmit;
        // Close the underlying stale SockJS Connection
        // It would be awfully surprising if a client ever saw this (as it
        // means two connections were simultaneously made for the same
        // robust session).
        robustConn._conn.close(errorcode.RETIRED, "Connection was retired by new connection");

        // Clear out any pending close/end messages, as we no longer plan to close.
        if (robustConn._withheld){
          robustConn._withheld.events = [];
          clearTimeout(robustConn._withheld.timer);
          robustConn._withheld.timer = 0;
        }

        if (resume) {
          // Tell the BufferedResendConnection (on the client) what message ID we
          // had been expecting before we got disconnected. If we had missed any
          // messages in the meantime, they can send them now.
          conn.write(robustConn._messageReceiver.CONTINUE());
          // The next message we receive better be the other side sending CONTINUE
          // to us too. This is not in response to our CONTINUE, but symmetrical
          // to it; both sides should send CONTINUE to each other immediately upon
          // reconnection.
          this._expectContinue = true;
        } else {
          // The client doesn't think we're resuming an existing connection, but
          // creating a new one; yet we already have an existing connection. It
          // had better be a nascent one.
          assert(robustConn.nascent, "set(conn,false) was called on a mature RobustConn");

          // OK, so we've got an essentially new connection here. The client
          // isn't going to send CONTINUE because it thinks we're a new conn,'
          // and it isn't expecting us to send CONTINUE either.

          // It's conceivable (though I don't think currently possible) that
          // messages were sent from us to the client already, in that case they
          // certainly wouldn't have received them (because they think this is
          // a new connection, and how could they have received messages over a
          // connection that didn't exist yet). So go ahead and resend all of
          // the messages in the buffer (guaranteed to start from 0 because for
          // it not to, we would've needed to receive an ACK message and could
          // therefore not possibly be nascent now).
          var msgs = robustConn._messageBuffer.getMessagesFrom(0);
          if (msgs.length > 0) {
            logger.debug("Sending " + msgs.length + " buffered messages from nascent");
          }
          while (msgs.length) {
            conn.write(msgs.shift());
          }
        }
      }

      // Set the new connection

      // Update all of our properties
      this._conn = conn;
      this.url = conn.url;
      this.address = conn.address;
      this.headers = conn.headers;

      // Override the underlying connection's emit so we can echo from our
      // RobustConn.
      conn._oldEmit = conn.emit;
      conn.emit = function(type) {
        function doEmit(){
          // We need to emit on the connections[id] object.
          robustConn.emit.apply(robustConn, arguments);
          conn._oldEmit.apply(conn, arguments);
        }
        if (type === 'data') {
          // As soon as we receive a single message, this robustConn is no
          // longer consider nascent, but mature.
          robustConn.nascent = false;

          // In this try block, we'll deal with the extra protocol stuff that
          // the client adds in BufferedResendConnection. Their side can send
          // us messages, and we can send them messages. Each side tags its
          // messages with monotonically increasing hexadecimal message IDs
          // (each side has its own sequence). And each side records the most
          // recent ID it's seen.
          //
          // When receiving a message, there are three extra things we may need
          // to deal with.
          //
          // 1) Upon disconnection and reconnection, the first message received
          //    after reconnection MUST be "CONTINUE <id>". This tells us the
          //    last message id from us the other side heard before we got
          //    disconnected (actually it is <last message id> + 1). If we get
          //    this message we must replay any missed messages. If we don't
          //    get the CONTINUE message but a different one instead, that is
          //    a bad connection and we should abort immediately.
          //
          //    When we're waiting for CONTINUE to arrive, it's not safe for
          //    us to send any new messages; we must save them in _messageBuffer
          //    until we know whether they've missed any messages, lest we end
          //    up sending the messages out of order.
          //
          // 2) At any time (before or after CONTINUE) we can receive "ACK <id>"
          //    from client letting us know they've received our messages up to
          //    that id, and it's safe for us to discard them from our buffer.
          //
          // 3) Actual data messages are tagged with an id. We need to strip off
          //    the id, record it, possibly send an ACK with it, and then pass
          //    the data on.
          try {
            // An ACK can be received at any time, including when we are expecting
            // CONTINUE.
            var discardCount = robustConn._messageBuffer.handleACK(arguments[1]);
            if (discardCount >= 0) {
              // It was an ACK message and it was handled. Don't process the
              // message further.

              // logger.debug("Discarded " + discardCount);
              return;
            }

            if (robustConn._expectContinue) {
              var continueId = message_utils.parseCONTINUE(arguments[1]);
              if (continueId === null) {
                throw new Error("Robust protocol error: Expected CONTINUE message");
              }
              robustConn._expectContinue = false;

              robustConn._messageBuffer.discard(continueId);

              var msgs = robustConn._messageBuffer.getMessagesFrom(continueId);
              while (msgs.length) {
                conn.write(msgs.shift());
              }

              // It was a CONTINUE message and it was handled. Don't process
              // the message further.
              return;
            }

            // Regular message, we expect it to be tagged with an ID. The
            // receive() message will throw if not; if it is, then it'll take
            // note of the ID and return the untagged data.
            arguments[1] = robustConn._messageReceiver.receive(arguments[1]);

          } catch (e) {
            logger.warn("Error handling message: " + e);
            robustConn.close(errorcode.BAD_PROTOCOL, "Protocol error handling message: " + e);
            return;
          }

          doEmit.apply(null, arguments);
        } else if (type === 'end' || type === 'close'){
          logger.trace("Withholding event '" + type + "' from robust connection " + id);
          robustConn._withheld.events.push({arg: arguments});
          if (!robustConn._withheld.timer){
            robustConn._withheld.timer = setTimeout(function(){
              // If time has passed, actually kill the connection by emitting the
              // withheld events of close and/or end.
              var evt;
              while ((evt = robustConn._withheld.events.pop())){
                doEmit.apply(null, evt.arg);
              }
              logger.debug("Closing robust connection " + id);
              delete self._connections[id];
              robustConn._readyState = 3; // Mark as closed.
            }, self._timeout);
          }
        } else {
          doEmit.apply(null, arguments);
        }
      };
    };

    this.set(conn);
  };
  util.inherits(this.RobustConn, events.EventEmitter);
}
