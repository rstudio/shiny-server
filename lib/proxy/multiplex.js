/*
 * multiplex.js
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
var util = require('util');
var _ = require('underscore');
var path = require('path');

// MultiplexSocket sits on top of a SockJS server connection and raises
// "connection" events with logical SockJS server connections (channels)
// that look and behave like normal SockJS server connections, but share
// a single SockJS connection. Channels cannot outlive (or predate, for
// that matter) their underlying connections.
//
// Each message that comes across the physical connection will be tagged
// with the "id" of its logical connection. These ids need only be unique
// within the scope of each MultiplexSocket.
//
// Messages are strings formatted like this:
//
// channelId|method|data
//
// A message can be one of three types (methods):
//
// - "o": Open a new channel @ channelId (data is request URL)
// - "c": Close the channel (data has {code, reason})
// - "m": Channel message (data is the message)
//
// See shiny-server.js for the corresponding client code.
module.exports = MultiplexSocket;
function MultiplexSocket(conn) {
  events.EventEmitter.call(this);
  this.$conn = conn; // The single true SockJS connection that was opened
  this.$channels = {}; // The list of currently active channels

  var self = this;
  conn.on('close', function() {
    // The physical connection has gone away, we need to notify anyone
    // who is using any active channel.
    _.each(_.values(self.$channels), function(channel) {
      channel._destroy();
    });
    self.$channels = {};
  });
  conn.on('data', function(message) {
    // Message received from physical connection; parse and dispatch it
    message = parseMultiplexData(message);
    if (!message) {
      logger.warn('Invalid multiplex packet received');
      conn.close();
      return;
    }

    var id = message.id;
    var method = message.method;
    var payload = message.payload;

    var channel = self.$channels[id];
    if (!channel) {
      if (method === 'o') {
        // Handle the open URL as relative to the connection URL. We do this
        // to support a Proxy that might manipulate URLs for all HTTP requests,
        // but would be unable to massage the URL we specify in our WS JSON,
        // so we'll use relative references..
        if (!payload){
          // The parent request will just pass an empty string.
          payload = conn.url;
        } else{
					// It must be a relative path, compute the absolute path for SockJS
          var parUrl = conn.url;
          parUrl = parUrl.replace(/\/__sockjs__\/.*$/, "/");
          payload = path.join(parUrl, payload);
        }

        // It's a request to open a new channel with the given id.
        // We want the channel to look a lot like a real SockJS connection,
        // so let's copy the properties from the actual connection. We'll
        // overwrite the `url` though, to use the channel's URL.
        var properties = _.extend(_.pick(conn, connectionProps), {url: payload});
        channel = new MultiplexChannel(id, conn, properties);
        self.$channels[id] = channel;
        self.emit('connection', channel);
      } else {
        // TODO: ...what? Close conn?
      }
    }
    else {
      // The channel exists

      if (method === 'c') {  // The client closed the channel
        channel._destroy(payload.code, payload.reason);
      } else if (method === 'm') {  // The client sent a message
        channel.emit('data', payload);
      }
    }
  });
}
util.inherits(MultiplexSocket, events.EventEmitter);

(function() {
}).call(MultiplexSocket.prototype);

// Fake SockJS connection that can be multiplexed over a real SockJS
// connection.
function MultiplexChannel(id, conn, properties) {
  events.EventEmitter.call(this);
  this.$id = id;  // The channel id
  this.$conn = conn;  // The underlying SockJS connection
  _.extend(this, properties);  // Apply extra properties to this object
  this.readyState = this.$conn.getReadyState();
  assert(this.readyState === 1); // copied from the (definitely active) conn
}
util.inherits(MultiplexChannel, events.EventEmitter);

(function() {
  this.write = function(message) {
    if (this.readyState === 1)
      this.$conn.write(formatMessage(this.$id, message));
  };
  this.close = function(code, reason) {
    if (this.readyState === 1 && this.$conn.readyState === 1)
      this.$conn.write(formatCloseEvent(this.$id, code, reason));
    this._destroy(code, reason);
  };
  this.end = function() {
    this.close();
  };
  // Internal function to set the readyState and raise "close" event.
  // This can be used in place of close() when we don't want to send
  // a message to the client.
  this._destroy = function(code, reason) {
    this.readyState = 3;
    this.emit('close', {code: code, reason: reason});
  };
}).call(MultiplexChannel.prototype);

function formatMessage(id, message) {
  return id + '|m|' + message;
}
function formatOpenEvent(id, url) {
  return id + '|o|' + url;
}
function formatCloseEvent(id, code, reason) {
  return id + '|c|' + JSON.stringify({code: code, reason: reason});
}
function parseMultiplexData(msg) {
  try {
    var m = /^(\d+)\|(m|o|c)\|([\s\S]*)$/m.exec(msg);
    if (!m)
      return null;
    msg = {
      id: m[1],
      method: m[2],
      payload: m[3]
    };

    switch (msg.method) {
      case 'm':
        break;
      case 'o':
        break;
      case 'c':
        try {
          msg.payload = JSON.parse(msg.payload);
        } catch(e) {
          return null;
        }
        break;
      default:
        return null;
    }

    return msg;

  } catch(e) {
    logger.debug('Error parsing multiplex data: ' + e);
    return null;
  }
}

// Properties to copy from sockjs connection to MultiplexChannel
var connectionProps = ['readable', 'writable', 'remoteAddress',
  'remotePort', 'address', 'headers', /* 'url', */ 'pathname',
  'prefix', 'protocol', 'readyState'];
