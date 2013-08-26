/*
 * tcp.js
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

var net = require('net');
var util = require('util');
var websocket = require('faye-websocket');
var Q = require('q');
var _ = require('underscore');
var BaseEndpoint = require('./shared').BaseEndpoint;

exports.Transport = Transport;
function Transport() {
}

(function() {

  this.setSocketDir = function(path) {
    // TCP transport doesn't use socket dir
  };

  /**
   * Return a port number that we believe to be unused. When finished, call
   * freePort to make the port available again.
   *
   * (Actually this implementation lets the OS pick a random port, and then
   * checks if the port is in use. If so, it retries. It's not actually
   * necessary to use freePort with this implementation but it seems like
   * a good idea to keep that discipline in case we later need to switch
   * to a preallocated list of ports for some reason.)
   */
  this.alloc_p = function() {
    var self = this;
    var deferred = Q.defer();

    var tries = arguments.length > 0 ? arguments[0] : 0;

    try {
      var server = net.createServer(function(conn) {conn.destroy();});
      server.on('error', function(e) {
        
        try {
          server.close();
        } catch (closeErr) {
        }

        try {
          if (e.code == 'EADDRINUSE') {
            logger.info('Could not bind port: ' + e.message);
            if (tries == 5) {
              logger.error('Giving up on binding port after 5 tries');
              deferred.reject(new Error("Couldn't find a free port"));
            } else {
              deferred.resolve(self.allocPort_p(tries+1));
            }
          } else {
            deferred.reject(e);
          }
        } catch (err) {
          deferred.reject(err);
        }
      });
      server.listen(0, '127.0.0.1', function() {
        var port = server.address().port;
        server.close();
        deferred.resolve(new Endpoint(port));
      });
    } catch (ex) {
      deferred.reject(ex);
    }


    return deferred.promise;
  };

}).call(Transport.prototype);


function Endpoint(port) {
  BaseEndpoint.call(this);
  this.$port = port;
}
util.inherits(Endpoint, BaseEndpoint);

(function() {

  // Return true if there is an active listener on the port
  this.connect_p = function() {
    var deferred = Q.defer();
    var client = net.connect({
      host: '127.0.0.1',
      port: this.$port
    });
    client.on('connect', function() {
      deferred.resolve(true);
      client.destroy();
    });
    client.on('error', function() {
      deferred.resolve(false);
      client.destroy();
    });
    return deferred.promise;
  };

  // Get the object that can be used as the "target" option for an http-proxy
  this.getHttpProxyTarget = function() {
    return {
      host: '127.0.0.1',
      port: this.$port
    };
  };

  // Return a new websocket.Client instance that's pointed at the target
  this.createWebSocketClient = function(headers) {
    return new websocket.Client('ws://127.0.0.1:' + this.$port + '/', undefined,
      {
        headers: _.extend(
          {'Shiny-Shared-Secret': this.getSharedSecret()},
          headers || {}
        )
      }
    );
  };

  this.getAppWorkerPort = function() {
    return this.$port + '';
  };

  this.getLogFileSuffix = function() {
    return this.getAppWorkerPort();
  };

  this.toString = function() {
    return "port " + this.$port;
  };

  // differs from toString by capitalization ;)
  this.ToString = function() {
    return "Port " + this.$port;
  };

  this.free = function() {
  };

}).call(Endpoint.prototype);
