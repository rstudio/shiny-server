/*
 * simple-event-bus.js
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

var events = require('events');
var map = require('../core/map');

var SimpleEventBus = function(){
  events.EventEmitter.call(this);
}
SimpleEventBus.prototype.__proto__ = events.EventEmitter.prototype;
module.exports = SimpleEventBus;

(function(){

}).call(SimpleEventBus.prototype);