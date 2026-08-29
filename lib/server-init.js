/*
 * server-init.js
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

// Builds the Shiny Server object graph and starts listening.
//
// This is everything lib/main.js used to do at module scope between the CLI
// argument handling and the signal handlers. It was extracted so that the
// server can be started in-process (by tests, primarily) without the CLI's side
// effects: process.exit on --version, optimist.argv at require time, and a
// pidfile lock. lib/main.js is now a thin wrapper around createServer_p.
//
// The middleware order below is load-bearing and is preserved verbatim from
// main.js; see memory-bank/requestLifecycle.md. In particular the two separate
// 'request' listeners on the Server facade must stay in this order, because
// app.handle mutates req.url before morgan reads req.originalUrl.

require('./core/log');
var crypto = require('crypto');
var fs = require('fs');
var url = require('url');
var compression = require('compression');
var client_sessions = require('client-sessions');
var express = require('express');
var morgan = require('morgan');
var Q = require('q');
var _ = require('underscore');
var connect_util = require('./core/connect-util');
var paths = require('./core/paths');
var qutil = require('./core/qutil');
var render = require('./core/render');
var version = require('./core/version');
var proxy_http = require('./proxy/http');
var proxy_sockjs = require('./proxy/sockjs');
var router = require('./router/router');
var config_router = require('./router/config-router');
var Server = require('./server/server');
var SchedulerRegistry = require('./scheduler/scheduler-registry');
var TcpTransport = require('./transport/tcp').Transport;
var SimpleEventBus = require('./events/simple-event-bus');
var LocalConfigRouter = require('./router/local-config-router');
var SquashRunAsRouter = require('./router/squash-run-as-router.js');

exports.createServer_p = createServer_p;
/**
 * Builds the server object graph, reads the config file, and starts listening.
 *
 * @param {string} configFilePath - Absolute path to the shiny-server.conf to
 *   read. Not read until the returned promise's work begins.
 * @param {object} [options]
 * @param {object} [options.transport] - Transport used to reach worker
 *   processes. Defaults to a TcpTransport. Tests substitute this to point the
 *   proxy at a stand-in worker.
 *
 * @returns {Promise} A promise of a handle. The promise does not resolve until
 *   the config has been read and every listener has either bound or failed to
 *   bind, so `addresses()` is populated by the time you see it. It rejects only
 *   if the config could not be read or is invalid; a listener that fails to
 *   bind is reported (as it always was) via a logged 'error' event and via the
 *   handle's `bindErrors`, which is what main.js's historical behaviour was.
 */
function createServer_p(configFilePath, options) {
  options = options || {};

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
  var transport = options.transport || new TcpTransport();

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
    res.setHeader('X-Powered-By', version.serverName);
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
      // KNOWN DEFECT (characterized, not yet fixed): `res` is not in scope
      // here, so this throws a ReferenceError instead of ending the socket.
      // See memory-bank/requestLifecycle.md §7.
      res.end();
      return;
    }
    // KNOWN DEFECT (characterized, not yet fixed): passing null for `res`
    // makes client-sessions throw internally and call back on nextTick with an
    // error this callback ignores, so req.session is never defined on the
    // upgrade path. See memory-bank/requestLifecycle.md §7.
    clientSessionMiddleware(request, null, function() {
      sockjsHandler.upgrade(request, socket, head);
    });
  });

  var requestLogger = null;
  server.on('request', function(req, res) {
    if (requestLogger)
      requestLogger(req, res);
  });

  // Bind errors from the most recent (re)load of the config. Empty when every
  // configured address came up.
  var bindErrors = [];

  var loadConfig_p = qutil.serialized(function() {
    return config_router.createRouter_p(configFilePath, schedulerRegistry)
    .then(function(configRouter) {
      indirectRouter.setRouter(configRouter);
      localConfigRouter.setAppOverride(configRouter.getAppOverride());
      var addresses_p = server.setAddresses(configRouter.getAddresses());
      schedulerRegistry.setTransport(transport);
      transport.setSocketDir(configRouter.socketDir);

      // Create SockJS server
      sockjsServer = proxy_sockjs.createServer(metarouter, schedulerRegistry,
        configRouter.sockjsHeartbeatDelay, configRouter.sockjsDisconnectDelay);
      sockjsHandler = sockjsServer.middleware();

      socketTimeout = configRouter.httpKeepaliveTimeout;

      useCompression = configRouter.httpAllowCompression;

      return createLogger_p(configRouter.accessLogSpec)
      .then(function(logfunc) {
        requestLogger = logfunc;
        logger.trace('Config loaded');
      })
      .then(function() {
        // Don't report the config as loaded until the sockets have actually
        // settled; setAddresses returns as soon as listen() is called.
        return addresses_p;
      })
      .then(function(errors) {
        bindErrors = errors;
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

  var handle = {
    app: app,
    server: server,
    eventBus: eventBus,
    schedulerRegistry: schedulerRegistry,
    transport: transport,

    /**
     * The addresses actually bound, as net.Server#address() objects. Useful
     * mainly for discovering the port when the config asked for `listen 0`.
     */
    addresses: function() {
      return server.addresses();
    },

    /**
     * Errors from the most recent attempt to bind. Empty on full success.
     */
    get bindErrors() {
      return bindErrors;
    },

    /**
     * Re-read the config file and swap in the config-derived pieces. This is
     * what SIGHUP does.
     */
    reload_p: function() {
      return loadConfig_p();
    },

    /**
     * Write the worker registry contents to the log. This is what SIGUSR1 does.
     */
    dump: function() {
      schedulerRegistry.dump();
    },

    /**
     * Stop accepting connections. Resolves once every listener has closed.
     * Note that this does not kill connections that are already established.
     */
    stopListening_p: function() {
      return server.destroy();
    },

    /**
     * Kill the worker processes. Synchronous, so that it can be called from a
     * 'exit' handler where no further timers will run.
     */
    shutdownWorkers: function() {
      schedulerRegistry.shutdown();
    },

    /**
     * Stop listening and kill the workers. Resolves once the listeners are
     * closed.
     */
    shutdown_p: function() {
      var stopped_p;
      try {
        stopped_p = server.destroy();
      } catch (err) {
        logger.error('Error while attempting to stop server: ' + err.message);
        stopped_p = Q.resolve();
      }
      return stopped_p.fin(function() {
        schedulerRegistry.shutdown();
      });
    }
  };

  return loadConfig_p().then(function() {
    return handle;
  });
}

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
}
