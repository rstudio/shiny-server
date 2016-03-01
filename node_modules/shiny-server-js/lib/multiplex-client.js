let log = require('./log');
let debug = require('./debug');

// MultiplexClient sits on top of a SockJS connection and lets the caller
// open logical SockJS connections (channels). The SockJS connection is
// closed when all of the channels close. This means you can't start with
// zero channels, open a channel, close that channel, and then open
// another channel.
module.exports = MultiplexClient;

function MultiplexClient(conn) {
  // The underlying SockJS connection. At this point it is not likely to
  // be opened yet.
  this._conn = conn;
  // A table of all active channels.
  // Key: id, value: MultiplexClientChannel
  this._channels = {};
  this._channelCount = 0;
  // ID to use for the next channel that is opened
  this._nextId = 0;
  // Channels that need to be opened when the SockJS connection's open
  // event is received
  this._pendingChannels = [];
  // A list of functions that fire when our connection goes away.
  this.onclose = []

  this._conn.onopen = () => {
    log("Connection opened. " + global.location.href);
    let channel;
    while ((channel = this._pendingChannels.shift())) {
      // Be sure to check readyState so we don't open connections for
      // channels that were closed before they finished opening
      if (channel.readyState === 0) {
        channel._open();
      } else {
        debug("NOT opening channel " + channel.id);
      }
    }
  };
  this._conn.onclose = (e) => {
    log("Connection closed. Info: " + JSON.stringify(e));
    debug("SockJS connection closed");
    // If the SockJS connection is terminated from the other end (or due
    // to loss of connectivity or whatever) then we can notify all the
    // active channels that they are closed too.
    for (let key in this._channels) {
      if (this._channels.hasOwnProperty(key)) {
        this._channels[key]._destroy(e);
      }
    }
    for (let i = 0; i < this.onclose.length; i++) {
      this.onclose[i]();
    }
  };
  this._conn.onmessage = (e) => {
    let msg = parseMultiplexData(e.data);
    if (!msg) {
      log("Invalid multiplex packet received from server");
      this._conn.close();
      return;
    }
    let id = msg.id;
    let method = msg.method;
    let payload = msg.payload;
    let channel = this._channels[id];
    if (!channel) {
      log("Multiplex channel " + id + " not found");
      return;
    }
    if (method === "c") {
      // If we're closing, we want to close everything, not just a subapp.
      // So don't send to a single channel.
      this._conn.close();
    } else if (method === "m") {
      channel.onmessage({data: payload});
    }
  };
}
MultiplexClient.prototype.open = function(url) {
  let channel = new MultiplexClientChannel(this, this._nextId++ + "",
                                           this._conn, url);
  this._channels[channel.id] = channel;
  this._channelCount++;

  switch (this._conn.readyState) {
    case 0:
      this._pendingChannels.push(channel);
      break;
    case 1:
      setTimeout(() => {
        channel._open();
      }, 0);
      break;
    default:
      setTimeout(() => {
        channel.close();
      }, 0);
      break;
  }
  return channel;
};
MultiplexClient.prototype.removeChannel = function(id) {
  delete this._channels[id];
  this._channelCount--;
  debug("Removed channel " + id + ", " + this._channelCount + " left");
  if (this._channelCount === 0 && this._conn.readyState < 2) {
    debug("Closing SockJS connection since no channels are left");
    this._conn.close();
  }
};

function MultiplexClientChannel(owner, id, conn, url) {
  this._owner = owner;
  this.id = id;
  this.conn = conn;
  this.url = url;
  this.readyState = 0;
  this.onopen = function() {};
  this.onclose = function() {};
  this.onmessage = function() {};
}
MultiplexClientChannel.prototype._open = function(parentURL) {
  debug("Open channel " + this.id);
  this.readyState = 1;

  //let relURL = getRelativePath(parentURL, this.url)

  this.conn.send(formatOpenEvent(this.id, this.url));
  if (this.onopen)
    this.onopen();
};
MultiplexClientChannel.prototype.send = function(data) {
  if (this.readyState === 0)
    throw new Error("Invalid state: can't send when readyState is 0");
  if (this.readyState === 1)
    this.conn.send(formatMessage(this.id, data));
};
MultiplexClientChannel.prototype.close = function(code, reason) {
  if (this.readyState >= 2)
    return;
  debug("Close channel " + this.id);
  if (this.conn.readyState === 1) {
    // Is the underlying connection open? Send a close message.
    this.conn.send(formatCloseEvent(this.id, code, reason));
  }
  this._destroy({code: code, reason: reason, wasClean: true});
};
// Internal version of close that doesn't notify the server
MultiplexClientChannel.prototype._destroy = function(e) {
  // If we haven't already, invoke onclose handler.
  if (this.readyState !== 3) {
    this.readyState = 3;
    debug("Channel " + this.id + " is closed");
    setTimeout(() => {
      this._owner.removeChannel(this.id);
      if (this.onclose)
        this.onclose(e);
    }, 0);
  }
}

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
    let m = /^(\d+)\|(m|o|c)\|([\s\S]*)$/m.exec(msg);
    if (!m)
      return null;
    msg = {
      id: m[1],
      method: m[2],
      payload: m[3]
    }

    switch (msg.method) {
      case 'm':
        break;
      case 'o':
        if (msg.payload.length === 0)
          return null;
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
