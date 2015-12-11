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

function RobustConn() {
}
util.inherits(RobustConn, events.EventEmitter);

module.exports = RobustSockJS;
function RobustSockJS(){
	this.connections = {};

	var self = this;
  // Robustify should just look up whether it exists, and deal with the matrix
  // of whether it does/expected to exist
  // THen once it finds a connection, it just returns the connection. Otherwise, it 
  // new()s one.
  // Robust is just an encapsulated abstraction for taking these underlying things.
	this.robustify = function(conn){
    var info = getInfo(conn);
    var id = conn.id;
    var existing = conn.existing;

    // The robust connection object to be returned.
		var robustConn;

		if (self.connections[id]){
      // We found this ID in our table.
      if (!existing){
        // The client was intending to create a new connection, but we already
        // have this ID. Either a very unlikely collision or a cache issue.
        logger.warn("RobustSockJS collision: " + id);
        conn.write('0|r|Unable to open connection.');
        setTimeout(function(){
          conn.close();
        }, 100);
        return;
      }

			// This must be a reconnect. We might not yet know that the client
			// was closed. So make the best effort to close the old one, and hot
			// swap in the new one.
			robustConn = self.connections[id];

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
		} else {
      if (existing){
        // The client expected us to have a record of this ID and we do not.
        logger.info("Disconnecting client because ID wasn't found.");
        conn.write('0|r|Your session could not be resumed on the server.');
        // Give it a chance to write.
        setTimeout(function(){
          conn.close();
        }, 100);
      }
      robustConn = new RobustConn();
      robustConn._buffer = [];
		}

    // Copy various properties over
    _.extend(robustConn, {
      _conn: conn,
      close: function(){ conn.close.apply(conn, arguments); },
      write: function(){
        // Write if this connection is ready.
        if (conn.readyState === 1){
          conn.write.apply(conn, arguments);
        } else {
          // Otherwise, buffer.
          robustConn._buffer.push({arg: arguments});
        }
      },
      _readyState: conn.readyState,
      getReadyState: function(){
        // We won't want to actually expose the ready state of the connection,
        // as it may come and go. We want to be in a good ready state until 
        // we're shutting down.
        return robustConn._readyState;
      },
      url: conn.url,
      address: conn.address,
      headers: conn.headers,
    });

		// Override the underlying connection's emit so we can echo.
		conn._oldEmit = conn.emit;
		conn.emit = function(type) {
      function doEmit(){
				robustConn.emit.apply(robustConn, arguments);
				conn._oldEmit.apply(conn, arguments);
      }

			if (type === 'end' || type === 'close'){
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
            delete self.connections[id];
            robustConn._readyState = 3; // Mark as closed.
          }, 15 * 1000);
        }
			} else {
        doEmit.apply(null, arguments);
			}
		};

    if (!self.connections[id]){
			// Add to registry
			logger.trace("Storing persistent connection with ID: " + id);
			self.connections[id] = robustConn;
		}

		return robustConn;
	};
}
