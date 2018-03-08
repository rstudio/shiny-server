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
const log4js = require("log4js");
const tty = require("tty");

// Only use colored output if stdout is a tty
const appender = tty.isatty(process.stdout.fd) ? "colored" : "basic";
log4js.configure({
  appenders: { "out": { type: "stdout", layout: { type: appender } } },
  categories: { default: { appenders: ["out"], level: "info" } }
});

global.logger = log4js.getLogger('shiny-server');

// Backward compatibility shim for log4js
logger.constructor.prototype.setLevel = function(level) {
  this.level = level;
};
global.logger.setLevel(process.env.SHINY_LOG_LEVEL || 'INFO');
