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

var util = require('util');
var events = require('events');
var crypto = require('crypto');
var _ = require('underscore');

var MessageBuffer = require("shiny-server-client/common/message-buffer");
var MessageReceiver = require("shiny-server-client/common/message-receiver");
var message_utils = require("shiny-server-client/common/message-utils");

// If error, closes the connection and returns falsey.
function getInfo(conn){
  var m = /\/__sockjs__\/([no])=(\w+)\//.exec(conn.pathname);
  if (!m || m.length < 3){
    logger.warn("Invalid sockjs URL.");
    conn.close();
    return false;
  }
  var id = m[2];

  // Whether the client is claiming that this ID is new or not.
  var existing = m[1] === 'o';
  return {id: id, existing: existing};
}

// Write a fatal message to a connection and then close it after
// giving it a chance to write the message.
function writeFatalConn(conn, msg){
  conn.write('0|r|' + msg);
  setTimeout(function(){
    conn.close();
  }, 100);
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
  // In the case of an error, it will close the given connection with an error
  // message and return falsey.
	this.robustify = function(conn){
    var info = getInfo(conn);
    if (!info){
      writeFatalConn(conn, 'Invalid SockJS URL format.');
      return;
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

        self._connections[id].set(conn);
      } else {
        // Trying to create a new session with a colliding ID
        logger.warn("RobustSockJS collision: " + id);
        writeFatalConn(conn, "Unable to open connection");
        return;
      }
    } else {
      // ID not found in table

      if (existing) {
        // Trying to resume a session which we don't have a record of.
        logger.debug("Disconnecting client because ID wasn't found.");
        writeFatalConn(conn, 'Your session could not be resumed on the server.');
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
    this.getReadyState = function(){
      // We won't want to actually expose the ready state of the connection,
      // as it may come and go. We want to be in a good ready state until
      // we're shutting down.
      return robustConn._readyState;
    };
    this._withheld = {timer: null, events: []};

    // Swap out the SockJS connection behind this RobustConn
    this.set = function(conn){
      if (robustConn._conn) {
        // Retire old connection

        // Restore the original emit method so we don't see the bubbled
        // close/end events on our RobustConn.
        robustConn._conn.emit = robustConn._conn._oldEmit;
        // Close the underlying stale SockJS Connection
        robustConn._conn.close();

        // Clear out any pending close/end messages, as we no longer plan to close.
        if (robustConn._withheld){
          robustConn._withheld.events = [];
          clearTimeout(robustConn._withheld.timer);
          robustConn._withheld.timer = 0;
        }

        // Tell the BufferedResendConnection (on the client) what message ID we
        // had been expecting before we got disconnected. If we had missed any
        // messages in the meantime, they can send them now.
        conn.write(robustConn._messageReceiver.CONTINUE());
        // The next message we receive better be the other side sending CONTINUE
        // to us too. This is not in response to our CONTINUE, but symmetrical
        // to it; both sides should send CONTINUE to each other immediately upon
        // reconnection.
        this._expectContinue = true;
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
          // 2) At any time (after CONTINUE) we can get an "ACK <id>" from the
          //    other side letting us know they've received our messages up to
          //    that id, and it's safe for us to discard them from our buffer.
          //
          // 3) Actual data messages are tagged with an id. We need to strip off
          //    the id, record it, possibly send an ACK with it, and then pass
          //    the data on.
          try {
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

            var discardCount = robustConn._messageBuffer.handleACK(arguments[1]);
            if (discardCount >= 0) {
              // It was an ACK message and it was handled. Don't process the
              // message further.

              // logger.debug("Discarded " + discardCount);
              return;
            }

            // Regular message, we expect it to be tagged with an ID. The
            // receive() message will throw if not; if it is, then it'll take
            // note of the ID and return the untagged data.
            arguments[1] = robustConn._messageReceiver.receive(arguments[1]);

          } catch (e) {
            logger.warn("Error handling message: " + e);
            robustConn.close(3101, "Error handling message: " + e);
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
