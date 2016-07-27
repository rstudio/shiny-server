'use strict';
/*
 * log.js
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
let util = require('util');
let log4js = require('log4js');

global.logger = log4js.getLogger('shiny-server');
global.logger.setLevel(process.env.SHINY_LOG_LEVEL || 'INFO');

// Log when obj emits events
global.logEvents = function(obj, label) {
  if (!obj || !obj.emit) return;

  if (!label)
    label = obj.constructor ? obj.constructor.name : "Object";

  let oldEmit = obj.emit;
  obj.emit = function(eventType) {
    // Use obj.listeners(eventType).length instead of
    // obj.listenerCount(eventType) for EventEmitter3
    // compatibility
    logger.trace(util.format("Raised %s.%s (%d listeners)",
      label, eventType, obj.listeners(eventType).length));
    oldEmit.apply(this, arguments);
  };
};
