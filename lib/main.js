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

require('./core/log');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var url = require('url');
var util = require('util');
var compression = require('compression');
var client_sessions = require('client-sessions');
var express = require('express');
var morgan = require('morgan');
var optimist = require('optimist');
var Q = require('q');
var _ = require('underscore');
var Handlebars = require('handlebars');
var connect_util = require('./core/connect-util');
var fsutil = require('./core/fsutil');
var paths = require('./core/paths');
var qutil = require('./core/qutil');
var render = require('./core/render');
var shutdown = require('./core/shutdown');
var proxy_http = require('./proxy/http');
var proxy_sockjs = require('./proxy/sockjs');
var router = require('./router/router')
var config_router = require('./router/config-router');
var Server = require('./server/server');
var SchedulerRegistry = require('./scheduler/scheduler-registry');
var SimpleScheduler = require('./scheduler/simple-scheduler');
var TcpTransport = require('./transport/tcp').Transport;
var UnixSocketTransport = require('./transport/unix-socket').Transport;
var SimpleEventBus = require('./events/simple-event-bus');
var LocalConfigRouter = require('./router/local-config-router');
var SquashRunAsRouter = require('./router/squash-run-as-router.js');

// Version strings
(function() {
  if (fs.existsSync(paths.projectFile('VERSION'))) {
    SHINY_SERVER_VERSION = fs.readFileSync(
      paths.projectFile('VERSION'),
      { encoding: 'ascii' }
    ).trim();
  } else {
    var packageInfo =
      JSON.parse(fs.readFileSync(paths.projectFile('package.json')));
    SHINY_SERVER_VERSION = packageInfo['version'].trim() + '.0';
  }
})();

var serverName = 'Shiny Server';
var shinyVersionString = `${serverName} v` + SHINY_SERVER_VERSION;
var nodeVersionString = 'Node.js ' + process.version;
var versionString = shinyVersionString + ' (' + nodeVersionString + ')';

// --version
if (optimist.argv.version) {
  console.log(shinyVersionString);
  console.log(nodeVersionString);
  process.exit(0);
}

logger.info(versionString);

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

// A simple router function that does nothing but respond "OK". Can be used for
// load balancer health checks, for example.
function ping(req, res) {
  if (url.parse(req.url).pathname == '/ping') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('OK');
    return true;
  }
  return false;
}

// We'll need an eventBus...
var eventBus = new SimpleEventBus();

// ...routers...
var indirectRouter = new router.IndirectRouter(new router.NullRouter());
var localConfigRouter = new LocalConfigRouter(
    new router.RestartRouter(
      router.join(indirectRouter, ping)
    ), eventBus
  );
var metarouter = new SquashRunAsRouter(localConfigRouter);

// ...a scheduler registry...
var schedulerRegistry = new SchedulerRegistry(eventBus);

// ...a transport (connects this process with worker procs)...
var transport = new TcpTransport();

// ...an HTTP proxy...
var shinyProxy = new proxy_http.ShinyProxy(
  metarouter,
  schedulerRegistry
);

var compressionMiddleware = compression();
let useCompression = true;

var clientSessionMiddleware = client_sessions({
  secret: crypto.randomBytes(16).toString('hex')
});

// Setup a placeholder middleware function until we can create one after 
// parsing the config.
var sockjsServer = false;
var sockjsHandler = function(req, res){
  return false;
}

var app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', serverName);
  next();
});
app.use(function(req, res, next) {
  if (useCompression)
    compressionMiddleware(req, res, next);
  else
    next();
});
app.use(clientSessionMiddleware);
app.use(function(req, res, next) {
  if (!sockjsHandler(req, res))
    next();
});
// Set up 
var assets = express.static(paths.projectFile('assets'),
  {maxAge:86400000}); // one day
var ssjAssets = express.static(paths.projectFile('node_modules/shiny-server-client/dist/'),
  {maxAge:86400000}); // one day
var sockjsAssets = express.static(paths.projectFile('node_modules/sockjs-client/dist/'),
  {maxAge:86400000}); // one day

app.use(connect_util.filterByRegex(
  /\b__assets__\/.+/,
  function (req, res, next) {
    function next404() { render.error404(req, res); }
    // Need to trim off the directory, as if we got here via a connect route
    req.originalUrl = req.originalUrl || req.url;
    req.url = req.url.replace(/^.*\b__assets__\//, '')
      .replace(/^\?/, '/?'); // __assets__/?foo was throwing 500 instead of 404
    if (req.url === 'shiny-server-client.js' || req.url === 'shiny-server-client.min.js') {
      ssjAssets(req, res, next404);
    } else if (/^sockjs(\.min)?\.js(\.map)?$/.test(req.url)) {
      sockjsAssets(req, res, next404);
    } else {
      assets(req, res, next404);
    }
  }
));
app.use(shinyProxy.httpListener);

var socketTimeout = 45 * 1000;

// Now create a server and hook everything up.
var server = new Server();
server.on('connection', function(socket) {
  // Close HTTP connections that haven't seen traffic in 45 seconds.
  //
  // SockJS sends a heartbeat every 25s so as long as we wait significantly
  // longer than that to timeout, we shouldn't need to worry about closing
  // active connections.
  //
  // jcheng 11/17/2016: This doesn't work as well as you'd think. The timeout
  // timer starts at e.g. the last invocation of write(), not waiting for
  // that write to actually complete. In other words, there can be actual
  // activity happening over the socket and yet the timeout can be hit. It's
  // unclear whether the Node maintainers consider this a bug or not. See
  // PR @rstudio/shiny-server#264 for all the gory details.
  socket.setTimeout(socketTimeout);
});
server.on('request', _.bind(app.handle, app));
server.on('error', function(err) {
  logger.error('HTTP server error (' + err.listenKey + '): ' + err.message);
});
server.on('clientError', function(err) {
  // ETIMEDOUT, EPIPE, ECONNRESET, "This socket is closed." are all very
  // very common occurrences.
  logger.debug('HTTP client error (' + err.listenKey + '): ' + err.message);
});

server.on('upgrade', function(request, socket, head) {
  if (!sockjsServer){
    logger.warn("Can't route sockJS traffic until configuration file is parsed.");
    res.end();
    return;
  }
  clientSessionMiddleware(request, null, function() {
    sockjsHandler.upgrade(request, socket, head);
  });
});


var requestLogger = null;
server.on('request', function(req, res) {
  if (requestLogger)
    requestLogger(req, res);
});

var loadConfig_p = qutil.serialized(function() {
  return config_router.createRouter_p(configFilePath, schedulerRegistry)
  .then(function(configRouter) {
    indirectRouter.setRouter(configRouter);
    localConfigRouter.setAppOverride(configRouter.getAppOverride());
    server.setAddresses(configRouter.getAddresses());
    schedulerRegistry.setTransport(transport);
    transport.setSocketDir(configRouter.socketDir);

    // Create SockJS server
    sockjsServer = proxy_sockjs.createServer(metarouter, schedulerRegistry,
      configRouter.sockjsHeartbeatDelay, configRouter.sockjsDisconnectDelay,
      configRouter.reconnectTimeout);
    sockjsHandler = sockjsServer.middleware();

    socketTimeout = configRouter.httpKeepaliveTimeout;

    useCompression = configRouter.httpAllowCompression;

    return createLogger_p(configRouter.accessLogSpec)
    .then(function(logfunc) {
      requestLogger = logfunc;
      logger.trace('Config loaded');
    });
  })
  .fail(function(err) {
    if (err.code === 'ENOENT') {
      logger.error('Error loading config: File "' + configFilePath + '" does not exist');
    } else {
      logger.error('Error loading config: ' + err.message);
    }
    throw err;
  });
});

loadConfig_p()
.fail(err => {
  // If we fail to load the config during startup, exit with a
  // failing error code.
  process.exit(1);
})
.eat();

function createLogger_p(logSpec) {
  if (!logSpec || !logSpec.path) {
    logger.debug('No access log configured');
    return Q.resolve(null);
  }

  logger.debug('Access log path: ' + logSpec.path);

  try {
    var stream = fs.createWriteStream(logSpec.path, {flags: 'a'});
    var next = function(){};
    var format = logSpec.format;
    if (format === "default") {
      format = "combined";  // "default" is deprecated in morgan
    }
    var log = morgan(format, {stream: stream});
    return Q.resolve(function(req, res) {
      log(req, res, next);
    });
    
  } catch (err) {
    return Q.reject(err);
  }
  return Q.nfcall(fs.open, logSpec.path, 'a', 0660)
  .then(function(fd) {
  })
  .fail(function(err) {
    logger.error('Error creating access log: ' + err.message);
    return null;
  });
}

// On SIGHUP (i.e., initctl reload), reload configuration
process.on('SIGHUP', function() {
  logger.info('SIGHUP received, reloading configuration');
  render.flushCache();
  loadConfig_p().eat();
});

// On SIGUSR1, write worker registry contents to log
process.on('SIGUSR1', function() {
  schedulerRegistry.dump();
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
  try {
    server.destroy();
  } catch (err) {
    logger.error('Error while attempting to stop server: ' + err.message);
  }
  logger.info('Shutting down worker processes (with notification)');
  schedulerRegistry.shutdown();
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
  schedulerRegistry.shutdown();
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
