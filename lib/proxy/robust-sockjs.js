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

function getInfo(conn){
  var m = /\/__sockjs__\/([no])=(\w+)\//.exec(conn.pathname);
  if (!m || m.length < 3){
    logger.warn("Invalid sockjs URL.");
    conn.close();
    return conn;
  }
  var id = m[2];

  // Whether the client is claiming that this ID is new or not.
  var existing = m[1] === 'o';
  return {id: id, existing: existing};
}

// We can't create a wholly new object, or we lose the references we've established
// on this obj elsewhere.
function RobustConn(conn, id, deleteCB) {
  // Extend eventEmitter
  events.EventEmitter.call(this);

  var robustConn = this;

  this._buffer = [];
  this._conn = conn;
  this.close = function(){ conn.close.apply(conn, arguments); };
  this.write = function(){
    // Write if this connection is ready.
    if (conn.readyState === 1){
      conn.write.apply(conn, arguments);
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
  this.url = conn.url;
  this.address = conn.address;
  this.headers = conn.headers;

  // Override the underlying connection's emit so we can echo from our
  // RobustConn.
  conn._oldEmit = conn.emit;
  conn.emit = function(type) {
    function doEmit(){
      //FIXME: this is busted. we're emitting on these disposable objects that
      // aren't going to be copied over the the real object others are pointing to.
      // We need to emit on the connections[id] object.
      robustConn.emit.apply(robustConn, arguments);
      conn._oldEmit.apply(conn, arguments);
    }

    if (type === 'end' || type === 'close'){
      logger.trace("Withholding event '" + type + "' from robust connection " + id);
      if (!robustConn._withheld){
        robustConn._withheld = {timer: null, events: []};
      }
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
          deleteCB();
          robustConn._readyState = 3; // Mark as closed.
        }, 15 * 1000);
      }
    } else {
      doEmit.apply(null, arguments);
    }
  };
}
util.inherits(RobustConn, events.EventEmitter);

// Write a fatal message to a connection and then close it after
// giving it a chance to write the message.
function writeFatalConn(conn, msg){
  conn.write('0|r|' + msg);
  setTimeout(function(){
    conn.close();
  }, 100);
}

module.exports = RobustSockJSRegistry;
function RobustSockJSRegistry(){
  this.connections = {};

  var self = this;

  // Replace the existing record of a connection in our connections table with
  // this new conncetion for the given ID.
  this.retireConnection = function(id, conn){
    // This is a reconnect. We might not yet know that the client
    // was closed. So make the best effort to close the old one, and hot
    // swap in the new one.
    var robustConn = self.connections[id];

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
  };

  // We can't assign to the connections map since we gave that reference to
  // others who will continue to reference it. So we need to keep avoid
  // overwriting the reference, but just copy in methods and properties.
  this.replaceConnection = function(id, robustConn){
    var properties = ['_buffer', '_conn', '_close', '_readyState', 'url', 'address', 'headers'];
    var methods = ['_close', 'getReadyState', 'write'];

    var conn = self.connections[id];

    // Copy properties
    _.each(properties, function(p){
      conn[p] = robustConn[p];
    });

    // Copy methods
    _.each(methods, function(m){
      conn[m] = function(){
        robustConn[m].apply(robustConn, arguments); 
      };
    });

    // The original object has its eventEmitters already wired in, but now that
    // we're using this new object, we want to use its events, too.
    // Bubble events by overwriting the emit method (so we can capture all
    // events).
    // TODO: not a memory leak that we don't ever unregister, right?
    var oldEmit = robustConn.emit;
    robustConn.emit = function(){
      oldEmit.apply(robustConn, arguments);
      conn.emit.apply(conn, arguments);
    };
  };

  // Handle the incoming connection, either mapping it to an existing session
  // or creating a new Robust connection encapsulation for it.
  // In the case of an error, it will close the given connection with an error
  // message and return fasley.
	this.robustify = function(conn){
    var info = getInfo(conn);
    var id = info.id;
    var existing = info.existing;

    // The robust connection object to be returned.
    var robustConn;

    if (self.connections[id]){
      // ID found in table

      if (existing){
        // Reconnecting to an existing session
        logger.debug("Reconnecting to robust connection: " + id);

        // Retire the old connection, writing any buffered data into the new 
        // conn.
        self.retireConnection(id, conn);

        // Create and store the new RobustConn.
        robustConn = new RobustConn(conn, id, function(){
          delete self.connections[id];
        });

        // Effectively a pass-by-ref version of: 
        //   `self.connections[id] = robustConn`
        self.replaceConnection(id, robustConn);
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
        logger.info("Disconnecting client because ID wasn't found.");
        writeFatalConn(conn, 'Your session could not be resumed on the server.');
        return;
      } else {
        // Creating a new connection.
        logger.debug("Creating a new robust connection: " + id);
        self.connections[id] = new RobustConn(conn, id, function(){
          delete self.connections[id];
        });
      }
    }

    return self.connections[id];
  };
}
