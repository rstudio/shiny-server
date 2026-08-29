#!/usr/bin/env node
/*
 * main.js
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

// The command-line entry point. Everything that actually builds and runs the
// server lives in lib/server-init.js; what's left here is the part that only
// makes sense for a process launched from a shell: argument parsing, the
// pidfile, process.exit, and the signal handlers.

require('./core/log');
var fs = require('fs');
var path = require('path');
var optimist = require('optimist');
var fsutil = require('./core/fsutil');
var render = require('./core/render');
var shutdown = require('./core/shutdown');
var version = require('./core/version');
var server_init = require('./server-init');

// --version
if (optimist.argv.version) {
  console.log(version.shinyVersionString);
  console.log(version.nodeVersionString);
  process.exit(0);
}

logger.info(version.versionString);

var unlinkPidFile = function() {};
if (optimist.argv.pidfile) {
  var pidfile = optimist.argv.pidfile;
  if (typeof(pidfile) !== 'string') {
    console.error('ERROR: Argument is required for pidfile');
    process.exit(1);
  }
  pidfile = path.resolve(pidfile);
  logger.info('Using pidfile ' + pidfile);
  if (!fsutil.createPidFile(pidfile)) {
    console.error('ERROR: Could not lock pidfile. Is another instance of ' +
                  'Shiny Server running?');
    process.exit(1);
  }
  unlinkPidFile = function() {
    fs.unlink(pidfile, function(err) {
      logger.warn('Error deleting pidfile: ' + err);
    });
  };
  process.on('exit', function() {
    unlinkPidFile();
  });
} else {
  logger.debug('No pidfile requested');
}

var configFilePath = '/etc/shiny-server/shiny-server.conf';
if (optimist.argv._.length >= 1) {
  configFilePath = path.resolve(optimist.argv._[0]);
}

logger.info('Using config file "' + configFilePath + '"');

// The handle returned by createServer_p. Null until the first successful
// startup; the signal handlers below tolerate that, because a signal can
// arrive while the config is still being read.
var handle = null;

server_init.createServer_p(configFilePath)
.then(function(h) {
  handle = h;
})
.fail(err => {
  // If we fail to load the config during startup, exit with a
  // failing error code.
  process.exit(1);
})
.eat();

// On SIGHUP (i.e., initctl reload), reload configuration
process.on('SIGHUP', function() {
  logger.info('SIGHUP received, reloading configuration');
  render.flushCache();
  if (handle)
    handle.reload_p().eat();
});

// On SIGUSR1, write worker registry contents to log
process.on('SIGUSR1', function() {
  if (handle)
    handle.dump();
});

// Clean up worker processes on shutdown

// Save exit code as global, cause exiting involves lots of callbacks.
let exitCode = 0;
// Ensure cleanup only happens once.
let needsCleanup = true;
function gracefulShutdown() {
  // Sometimes the signal gets sent twice. No idea why.
  if (!needsCleanup)
    return;

  // On SIGINT/SIGTERM (i.e. normal termination) we wait a second before
  // exiting so the clients can all be notified
  shutdown.shuttingDown = true;
  if (handle) {
    try {
      handle.stopListening_p().eat();
    } catch (err) {
      logger.error('Error while attempting to stop server: ' + err.message);
    }
    logger.info('Shutting down worker processes (with notification)');
    handle.shutdownWorkers();
  }
  needsCleanup = false;
  setTimeout(() => {
    process.exit(exitCode);
  }, 500);
}

function lastDitchShutdown(code) {
  if (exitCode === 0 && code !== 0) {
    exitCode = code;
  }

  if (!needsCleanup)
    return;
  // More-violent shutdown (e.g. uncaught exception), no chance to notify
  // workers as timers won't be scheduled
  shutdown.shuttingDown = true;
  logger.info('Shutting down worker processes');
  if (handle)
    handle.shutdownWorkers();
}

function shutdownWithExitCode(code) {
  return () => {
    exitCode = code;
    gracefulShutdown();
  };
}

process.on('SIGINT', shutdownWithExitCode(128 + 2));
process.on('SIGTERM', shutdownWithExitCode(128 + 15));
process.on('SIGABRT', shutdownWithExitCode(128 + 6));
process.on('uncaughtException2', shutdownWithExitCode(1));
process.on('uncaughtException', function(err) {
  logger.error('Uncaught exception: ' + err);
  logger.error(err.stack);
  process.emit('uncaughtException2', err);
  throw err;
});
process.on('exit', lastDitchShutdown);

if (optimist.argv.memlog) {
  var memstatsPath = 'mem-' + process.pid + '.csv';
  logger.info('Writing memory log to ' + memstatsPath);
  var memstatsStream = fs.createWriteStream(memstatsPath, {
    encoding: 'utf-8',
    mode: 0664
  });
  memstatsStream.write('rss,heapTotal,heapUsed\n');
  setInterval(function() {
    var snapshot = process.memoryUsage();
    memstatsStream.write(snapshot.rss + ',' + snapshot.heapTotal + ',' + snapshot.heapUsed + '\n');
  }, 2000);
}
