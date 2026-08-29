/*
 * server.js
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
var assert = require('assert');
var events = require('events');
var http = require('http');
var util = require('util');
const url = require('url');
var Q = require('q');
var _ = require('underscore');
const iputil = require('../core/iputil');
var map = require('../core/map');

// Convert an address object ({address: 127.0.0.1, port: 80}, for example) to
// a string that is suitable for indexing into an object (turns out a URL is
// pretty good for this). We'll use this to index http.Server objects by
// host/port combinations.
function addressToKey(address) {
  const protocol = "http";
  const host = iputil.addrToHostname(iputil.normalize(address.address));
  return `${protocol}://${host}:${address.port}`;
}

module.exports = Server;
/**
 * Presents the same events as a regular NodeJS HTTP server, but can listen on
 * multiple host/port combinations at the same time. If distinguishing between
 * the different hosts/ports is important, then look at request.host and
 * request.port in the event listener.
 *
 * You can change the set of hosts/ports that are listened to on the fly by
 * calling setAddresses multiple times. Any host/port combinations that are
 * already being listened on are undisturbed; any obsoleted servers are shut
 * down; and any new host/ports have new servers instantiated and started.
 */
function Server() {
  var this_Server = this;
  events.EventEmitter.call(this);

  this.$wildcards = map.create();
  this.$hosts = map.create();
  this.$eventNames = [];

  // When a caller adds a new listener, we need to see if it's an event name
  // we've never seen before; if so, we need to make sure this event gets
  // forwarded by all current and future HTTP server instances.
  this.on('newListener', function(eventName, listener) {
    // Never forward newListener, too confusing.
    if (eventName == 'newListener')
      return;

    // If this is an event name we've seen before, no need to do anything.
    if (_.contains(this.$eventNames, eventName))
      return;

    // Make all current servers forward this event.
    _.each(_.values(this.$wildcards).concat(_.values(this.$hosts)),
      function(server) {
        forwardEvent(server, this_Server, eventName);
      }
    );

    // Ensure all future servers forward this event.
    this.$eventNames.push(eventName);
  });
}

util.inherits(Server, events.EventEmitter);

(function() {
  this.setAddresses = function(addresses) {
    var wildcardKeys = [];
    var hostKeys = [];
    _.each(addresses, function(address) {
      const key = addressToKey(address);
      if (iputil.isWildcard(address.address)) {
        wildcardKeys.push(key);
      } else {
        hostKeys.push(key);
      }
    });

    // It's possible for there to be duplicate address/port combos because
    // you can have server scopes that listen on the same address/port but
    // are distinguished by hostname (server_name)
    wildcardKeys = _.uniq(wildcardKeys);
    hostKeys = _.uniq(hostKeys);

    var toCloseW = _.difference(_.keys(this.$wildcards), wildcardKeys);
    var toOpenW = _.difference(wildcardKeys, _.keys(this.$wildcards));
    var toCloseH = _.difference(_.keys(this.$hosts), hostKeys);
    var toOpenH = _.difference(hostKeys, _.keys(this.$hosts));

    // Deliberately not awaited. server.close() doesn't complete until every
    // established connection has ended, and on a config reload that could be
    // hours (a SockJS session on a listener the new config drops). The obsolete
    // listeners stop accepting immediately either way; making the caller wait
    // for them would stall the next reload behind them, since loadConfig_p is
    // serialized.
    // (Not `.eat()`: that is installed on Q's prototype by lib/core/qutil, and
    // this module doesn't require it.)
    Q.all([
      this.$close(this.$wildcards, toCloseW),
      this.$close(this.$hosts, toCloseH)
    ]).fail(function() {});

    var opened_p = Q.all([
      this.$open(this.$wildcards, toOpenW),
      this.$open(this.$hosts, toOpenH)
    ]);

    // Resolves once every new listener has settled -- bound or failed -- with
    // the array of bind errors (empty on full success). Callers can rely on
    // addresses() being populated by then.
    return opened_p.then(function(results) {
      return _.flatten(results, true);
    });
  };

  /**
   * The addresses we are actually bound to, as returned by
   * net.Server#address(). Servers that haven't finished binding yet report
   * null from address(), and are omitted. Mostly useful for discovering the
   * port when the config asked for an ephemeral one (`listen 0`).
   */
  this.addresses = function() {
    return _.chain(_.values(this.$wildcards).concat(_.values(this.$hosts)))
      .map(function(server) { return server.address(); })
      .filter(function(address) { return !!address; })
      .value();
  };

  this.destroy = function() {
    return Q.all([
      this.$close(this.$wildcards, _.keys(this.$wildcards)),
      this.$close(this.$hosts, _.keys(this.$hosts))
    ]).then(function() {});
  };

  this.$close = function(table, keys) {
    function doClose(server, key) {
      return Q.Promise(function(resolve) {
        function closeNow() {
          logger.info('Stopping listener on ' + key);
          try {
            server.close(function(err) {
              if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
                logger.error(
                  'Error closing HTTP listener at ' + key + ': ' + err.message);
              }
              resolve();
            });
          } catch(ex) {
            logger.error(
              'Error closing HTTP listener at ' + key + ': ' + ex.message);
            resolve();
          }
        }

        if (server.listening) {
          closeNow();
          return;
        }

        // The server is still binding. Closing it now would be a no-op, and
        // since we're about to drop it from the table nobody would be left
        // holding a reference to close it once the bind completes -- a leaked
        // listener. Wait for the bind to resolve one way or the other instead.
        // ($open guarantees exactly one of these fires: a server that fails to
        // bind emits 'error' and never emits 'listening'.)
        server.once('listening', closeNow);
        server.once('error', function() { resolve(); });
      });
    }

    var server;
    var promises = _.map(keys, function(key) {
      assert(_.has(table, key));
      server = table[key];
      var closed_p = doClose(server, key);
      removeFromTable(table, key, server);
      return closed_p;
    });

    return Q.all(promises);
  };

  /**
   * Starts a listener for each of `keys`. Returns a promise of an array of
   * the bind errors that occurred (empty if every listener came up). The
   * promise settles only once every listener has emitted either 'listening'
   * or 'error', so a caller that awaits it can rely on addresses() being
   * populated. It never rejects: a failed bind is logged and forwarded as an
   * 'error' event exactly as it always was, and it is up to the caller to
   * decide whether that is fatal.
   */
  this.$open = function(table, keys) {
    var this_Server = this;

    function doOpen(table, key) {
      assert(!_.has(table, key));

      let parsedUrl;
      try {
        // We use url.URL here instead of url.parse because it's more strict
        // (url.parse will happily accept "Foo" as a URL and just treat it as
        // a relative path, I guess). But url.URL has the unfortunate side
        // effect of dropping the port if it's port 80, even if key has the port
        // explicitly included e.g. "http://localhost:80". Hence the conditional
        // below where we default it back to 80.
        parsedUrl = new url.URL(key);
      } catch (e) {
        assert(false, `Invalid HTTP server key: "${key}"`);
      }

      var addr = iputil.hostnameToAddr(parsedUrl.hostname);
      var port;
      if (parsedUrl.port === "" || parsedUrl.port === null) {
        port = 80;
      } else {
        port = +parsedUrl.port;
      }

      var server = http.createServer();

      // Note: server.listening is a getter on net.Server.prototype with no
      // setter, so it can only be read, never assigned. The value it reports
      // (!!this._handle) is maintained by Node itself and is what the reads
      // below rely on.

      server.on('close', function() {
        // If the server closes, delete it from its table
        removeFromTable(table, key, server);
      });
      server.on('error', function(err) {
        if (!server.listening) {
          // If server errored before successfully binding, we won't ever get a
          // close event and need to delete now.
          removeFromTable(table, key, server);
        }
        // Annotate the error with some additional info so other error event
        // listeners can get to it if needed.
        err.listenKey = key;
        err.source = server;
      });

      this_Server.$forwardAll(server);

      // Resolves (never rejects) once this listener has either come up or
      // failed to bind, so that callers can wait for startup to settle.
      var bound_p = Q.Promise(function(resolve) {
        server.once('listening', function() { resolve(null); });
        server.once('error', function(err) { resolve(err); });
      });

      logger.info('Starting listener on ' + key);
      logger.debug(`Actual addr: ${addr}`);
      logger.debug(`Actual port: ${port}`);
      server.listen(port, addr, function(err) {
        if (err)
          logger.error('Error listening on ' + key + ': ' + err.message);
      });
      table[key] = server;

      return bound_p;
    }

    return Q.all(_.map(keys, function(key) {
      return doOpen(table, key);
    })).then(function(results) {
      return _.filter(results, function(err) { return !!err; });
    });
  };

  function removeFromTable(table, key, server) {
    if (table[key] === server)
      delete table[key];
  };

  this.$forwardAll = function(server) {
    var this_Server = this;

    function emitter(evt) {
      this.emit.apply(this, arguments);
    }

    _.each(this.$eventNames, function(eventName) {
      forwardEvent(server, this_Server, eventName);
    });
  };
}).call(Server.prototype);


function forwardEvent(from, to, eventName) {
  function emitter(evt) {
    this.emit.apply(this, arguments);
  }
  
  from.on(eventName, _.bind(emitter, to, eventName));
}
