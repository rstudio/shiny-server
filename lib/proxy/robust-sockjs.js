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

module.exports = RobustSockJS;
function RobustSockJS(){
	this.connections = {};

	var self = this;
	this.robustify = function(conn){
    var m = /\/__sockjs__\/([no])=(\w+)\//.exec(conn.pathname);
		if (!m || m.length < 3){
			logger.warn("Invalid sockjs URL.");
			conn.close();
			return conn;
		}
		var id = m[2];

    // Whether the client is claiming that this ID is new or not.
    var existing = m[1] === 'o';

		var oldConn = null;
		var robustConn = null;
		if (self.connections[id]){
			// This must be a reconnect. We might not yet know that the client
			// was closed. So make the best effort to close the old one, and hot
			// swap in the new one.
			robustConn = self.connections[id];

      // Clear out any pending close/end messages
      if (robustConn._withheld){
        robustConn._withheld.events = [];
        clearTimeout(robustConn._withheld.timer);
        robustConn._withheld.timer = 0;
      }

      // Copy various properties over
      _.extend(robustConn, _.pick(conn, connectionProps));

			robustConn.close = function(){
				conn.close.apply(conn, arguments);
			};

      // Write any buffered events to the new connection
      var args;
      while ((args = robustConn._buffer.shift())){
        conn.write.apply(conn, args.arg);
      }
		
			// Store a record of the old connection so we can close it.
			oldConn = robustConn._originalConn;
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

			// This is a new connection. Create a robustConn object.
      // Copy the properties over to the new object so it looks more like 
      // a WebSocket.
      robustConn = _.clone(conn);
      robustConn._buffer = [];
		}

		robustConn._originalConn = conn;

    // Make write buffered
    robustConn.write = function(){
      if (conn.readyState === 1){
        conn.write.apply(conn, arguments);
      } else {
        robustConn._buffer.push({arg: arguments});
      }
    };
		
		// Override the underlying connection's emit so we can echo.
		var oldEmit = conn.emit;
		conn.emit = function(type) {
      function doEmit(){
				robustConn.emit.apply(robustConn, arguments);
				oldEmit.apply(conn, arguments);
      }

			if (type === 'end' || type === 'close'){
        if (!robustConn._withheld){          
          robustConn._withheld = {timer: null, events: []};
        }
        robustConn._withheld.events.push({arg: arguments});
        if (!robustConn._withheld.timer){
          robustConn._withheld.timer = setTimeout(function(){
            var evt;
            while ((evt = robustConn._withheld.events.pop())){
              doEmit.apply(null, evt.arg);
            }
          }, 15 * 1000);
        }

				// delete self.connections[id];
			} else {
        doEmit.apply(null, arguments);
			}
		};

		if (oldConn){
			// Assign, then close the old connection
			logger.debug("Replaced and closing SockJS connection #" + id);
			oldConn.close();
		} else {
			// Add to registry
			logger.trace("Storing persistent connection with ID: " + id);
			self.connections[id] = robustConn;
		}

		return robustConn;
	};
}

// Properties to copy from sockjs connection to MultiplexChannel
var connectionProps = ['readable', 'writable', 'remoteAddress',
  'remotePort', 'address', 'headers', 'url', 'pathname',
  'prefix', 'protocol', 'readyState'];
