var assert = require('assert');
var events = require('events');
var http = require('http');
var util = require('util');
var _ = require('underscore');
var map = require('../core/map');

module.exports = Server;
function Server() {
  events.EventEmitter.call(this);

  this.$wildcards = map.create();
  this.$hosts = map.create();
  this.$eventNames = [];

  this.on('newListener', function(eventName, listener) {
    if (eventName == 'newListener')
      return;

    assert(_.isEmpty(this.$wildcards) && _.isEmpty(this.$hosts),
      "Can't add listeners after setAddresses is called");

    if (!_.contains(this.$eventNames, eventName)) {
      this.$eventNames.push(eventName);
    }
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
      logger.info('Stopping listener on ' + key);
      server.close(function(err) {
        if (err) {
          logger.error(
            'Error closing HTTP listener at ' + key + ': ' + err.message);
        }
      });
    }

    var server;
    _.each(keys, function(key) {
      assert(_.has(table, key));
      server = table[key];
      delete table[key]
      doClose(server, key);
    });
  };

  this.$open = function(table, keys) {
    var this_Server = this;
    var match, server, port, hostname;
    _.each(keys, function(key) {
      assert(!_.has(table, key));

      match = /^([^:]+):(\d+)$/.exec(key);
      assert(match, 'Invalid HTTP server key: ' + key);

      hostname = match[1];
      port = +(match[2]);

      server = http.createServer();
      this_Server.$forwardAll(server);
      logger.info('Starting listener on ' + key);
      server.listen(port, hostname);
      table[key] = server;
    });
  };

  this.$forwardAll = function(server) {
    function emitter(evt) {
      this.emit.apply(this, arguments);
    }

    var this_Server = this;
    _.each(this.$eventNames, function(eventName) {
      server.on(eventName, _.bind(emitter, this_Server, eventName));
    });
  };
}).call(Server.prototype);
