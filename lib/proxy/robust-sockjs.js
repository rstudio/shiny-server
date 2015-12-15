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

    this._buffer = [];
    this.close = function(){ 
      robustConn._conn.close();
    };
    this.write = function(){
      // Write if this connection is ready.
      if (robustConn._readyState === 1){
        robustConn._conn.write.apply(robustConn._conn, arguments);
      } else {
        // Otherwise, buffer.
        robustConn._buffer.push({arg: arguments});
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

        // Write any buffered events to the new connection
        var args;
        while ((args = robustConn._buffer.shift())){
          conn.write.apply(conn, args.arg);
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
        if (type === 'end' || type === 'close'){
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
