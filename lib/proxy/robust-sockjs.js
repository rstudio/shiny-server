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
		var id = crypto.randomBytes(32).toString('hex')
		conn._robustId = id;

		if (conn.readyState === 1) {
			conn.write('0|i|' + id);
		} else {
			console.log("Conn not ready");
		}

		// Copy the properties over to the new object so it looks more like 
		// a WebSocket.
		var robustConn = _.clone(conn, connectionProps);
		robustConn._originalConn = conn;
		
		// Override the underlying connection's emit so we can echo.
		var oldEmit = conn.emit;
		conn.emit = function(type) {
			var emitArgs = arguments;
			if (type === 'end' || type === 'close'){
				// FIXME: Hold back events
				delete self.connections[id];
			} else {
			}
			robustConn.emit.apply(robustConn, arguments);
			oldEmit.apply(conn, arguments);
		};
		
		// Add to registry
		self.connections[id] = robustConn;

		return robustConn;
	};
}

// Properties to copy from sockjs connection to MultiplexChannel
var connectionProps = ['readable', 'writable', 'remoteAddress',
  'remotePort', 'address', 'headers', 'url', 'pathname',
  'prefix', 'protocol', 'readyState'];
