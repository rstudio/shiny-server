/*
 * version.js
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

// Resolves the Shiny Server version and publishes it as the SHINY_SERVER_VERSION
// global.
//
// This used to live inline in lib/main.js, which meant the global was only ever
// populated when the server was started from the command line. lib/worker/
// app-worker reads SHINY_SERVER_VERSION when it launches a worker, so anything
// that booted the server in-process (i.e. a test) got `undefined` sent to the
// app. Requiring this module is now what establishes the global, and
// lib/server-init.js does so on every startup path.

var fs = require('fs');
var paths = require('./paths');

exports.serverName = 'Shiny Server';

exports.getVersion = getVersion;
function getVersion() {
  if (fs.existsSync(paths.projectFile('VERSION'))) {
    return fs.readFileSync(
      paths.projectFile('VERSION'),
      { encoding: 'ascii' }
    ).trim();
  }
  var packageInfo =
    JSON.parse(fs.readFileSync(paths.projectFile('package.json')));
  return packageInfo['version'].trim() + '.0';
}

exports.version = getVersion();

// Kept as a global because lib/worker/app-worker.ts reads it that way.
SHINY_SERVER_VERSION = exports.version;

exports.shinyVersionString = `${exports.serverName} v` + exports.version;
exports.nodeVersionString = 'Node.js ' + process.version;
exports.versionString =
  exports.shinyVersionString + ' (' + exports.nodeVersionString + ')';
