/*
 * unix-socket.js
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

var crypto = require('crypto');
var fs = require('fs');
var net = require('net');
var path = require('path');
var util = require('util');
var websocket = require('faye-websocket');
var Q = require('q');
var _ = require('underscore');
var fsutil = require('../core/fsutil');
var BaseEndpoint = require('./shared').BaseEndpoint;

exports.Transport = Transport;
function Transport() {
  this.$socketDir = null;
}

(function() {

  this.setSocketDir = function(socketDir) {
    if (!socketDir) {
      socketDir = '/var/shiny-server/sockets'
    }

    this.$socketDir = socketDir;
    logger.info('Socket dir: ' + socketDir);
    if (!fsutil.directoryExistsSync(socketDir)) {
      logger.info('Socket dir does not exist, will create it');
      fs.mkdirSync(socketDir, 0733);
      // Not sure why but mkdirSync's mode parameter doesn't have the desired
      // effect. Do a chmodSync to ensure the perms get set correctly.
      fs.chmodSync(socketDir, 0733);
    }
  };

  /**
   * Return a random filename to go in $socketDir.
   */
  this.alloc_p = function() {
    var self = this;

    return Q.nfcall(crypto.randomBytes, 16)
    .then(function(buf) {
      return new Endpoint(self.$socketDir, buf.toString('hex'));
    }); 
  };

}).call(Transport.prototype);


function Endpoint(socketDir, name) {
  BaseEndpoint.call(this);
  this.$socketPath = path.join(socketDir, name + '.sock');
  this.$sockName = name.substring(0, 12);
}
util.inherits(Endpoint, BaseEndpoint);

(function() {

  // Return true if there is an active listener on the port
  this.connect_p = function() {
    var deferred = Q.defer();
    var client = net.connect({
      path: this.$socketPath
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
      socketPath: this.$socketPath
    };
  };

  // Return a new websocket.Client instance that's pointed at the target
  this.createWebSocketClient = function(path, headers) {
    return new websocket.Client('ws://127.0.0.1:' + this.$port + path, undefined,
      {
        socketPath: this.$socketPath,
        headers: _.extend(
          {'Shiny-Shared-Secret': this.getSharedSecret()},
          headers || {}
        )
      });
  };

  this.getAppWorkerPort = function() {
    return this.$socketPath;
  };

  this.getLogFileSuffix = function() {
    return this.$sockName;
  };

  this.toString = function() {
    return "socket " + this.$sockName;
  };

  // differs from toString by capitalization ;)
  this.ToString = function() {
    return "Socket " + this.$sockName;
  };

  this.free = function() {
  };

}).call(Endpoint.prototype);
