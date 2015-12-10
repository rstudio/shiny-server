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
    var m = /\/__sockjs__\/i=(\w+)\//.exec(conn.pathname);
		if (!m || m.length < 2){
			logger.warn("Invalid sockjs URL.");
			conn.close();
			return conn;
		}
		var id = m[1];

		var oldConn = null;
		var robustConn = null;
		if (self.connections[id]){
			// This must be a reconnect. We might not yet know that the client
			// was closed. So make the best effort to close the old one, and hot
			// swap in the new one.
			robustConn = self.connections[id];

			// Ensure that the public methods we use are current.
			robustConn.write = function(){
				conn.write.apply(conn, arguments);
			};
			robustConn.close = function(){
				conn.close.apply(conn, arguments);
			};
		
			// Store a record of the old connection so we can close it.
			oldConn = robustConn._originalConn;
		} else {
			// This is a new connection. Create a robustConn object.
			robustConn = _.clone(conn);
			robustConn._originalConn = conn;
		}

		// Copy the properties over to the new object so it looks more like 
		// a WebSocket.
		
		// Override the underlying connection's emit so we can echo.
		var oldEmit = conn.emit;
		conn.emit = function(type) {
			if (type === 'end' || type === 'close'){
				// FIXME: Emit eventually...
				// delete self.connections[id];
			} else {
				robustConn.emit.apply(robustConn, arguments);
				oldEmit.apply(conn, arguments);
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
