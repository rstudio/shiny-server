/*
 * shutdown.js
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
exports.shuttingDown = false;

// Stops the process represented by the given child_process object when
// this node.js process is terminated with SIGINT, SIGABRT, or SIGTERM.
exports.killOnShutdown = function(childProc, label) {
  function killChild() {
    if (label)
      logger.info('Stopping child ' + label + ' process');
    childProc.kill();
  }
  process.on('SIGINT', killChild);
  process.on('SIGTERM', killChild);
  process.on('SIGABRT', killChild);
  process.on('uncaughtException2', killChild);
  childProc.on('exit', function() {
    process.removeListener('SIGINT', killChild);
    process.removeListener('SIGTERM', killChild);
    process.removeListener('SIGABRT', killChild);
    process.removeListener('uncaughtException2', killChild);
  });
};
