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
var _ = require('underscore');
var map = require('../core/map');

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
      if (address.address === '*' || address.address === '0.0.0.0')
        wildcardKeys.push('0.0.0.0' + ':' + address.port);
      else
        hostKeys.push(address.address + ':' + address.port);
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

    this.$close(this.$wildcards, toCloseW);
    this.$close(this.$hosts, toCloseH);

    this.$open(this.$wildcards, toOpenW);
    this.$open(this.$hosts, toOpenH);
  };

  this.destroy = function() {
    this.$close(this.$wildcards, _.keys(this.$wildcards));
    this.$close(this.$hosts, _.keys(this.$hosts));
  };

  this.$close = function(table, keys) {
    function doClose(server, key) {
      if (!server.listening)
        return;

      logger.info('Stopping listener on ' + key);
      try {
        server.close(function(err) {
          if (err) {
            logger.error(
              'Error closing HTTP listener at ' + key + ': ' + err.message);
          }
        });
      } catch(ex) {
        logger.error(
          'Error closing HTTP listener at ' + key + ': ' + ex.message);
      }
    }

    var server;
    _.each(keys, function(key) {
      assert(_.has(table, key));
      server = table[key];
      doClose(server, key);
      removeFromTable(table, key, server);
    });
  };

  this.$open = function(table, keys) {
    var this_Server = this;

    function doOpen(table, key) {
      assert(!_.has(table, key));

      var match = /^([^:]+):(\d+)$/.exec(key);
      assert(match, 'Invalid HTTP server key: ' + key);

      var hostname = match[1];
      var port = +(match[2]);

      var server = http.createServer();

      server.on('close', function() {
        // If the server closes, make a note of it and delete it from its table
        server.listening = false;
        removeFromTable(table, key, server);
      });
      server.on('listening', function() {
        // Once the server starts listening successfully, make a note of it
        server.listening = true;
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

      logger.info('Starting listener on ' + key);
      server.listen(port, hostname, function(err) {
        if (err)
          logger.error('Error listening on ' + key + ': ' + err.message);
      });
      table[key] = server;
    }

    _.each(keys, function(key) {
      doOpen(table, key);
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
