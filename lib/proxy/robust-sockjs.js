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

var websocket = require('faye-websocket');
var util = require('util');
var events = require('events');

module.exports = RobustSockJS;
function RobustSockJS(){
	this.robustify = function(conn){
		// Override the underlying connection's emit so we can echo.
		var oldEmit = conn.emit;
		conn.emit = function(type) {
			var emitArgs = arguments;
			if (type === 'end' || type === 'close'){
				// FIXME: Hold back
				oldEmit.apply(conn, arguments);
			} else {
				oldEmit.apply(conn, arguments);
			}
		};
	};
}
