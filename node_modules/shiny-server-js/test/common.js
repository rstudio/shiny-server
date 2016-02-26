var util = require("../lib/util");
var WebSocket = require("../lib/websocket");

var message_utils = require("../common/message-utils");

// A mock connection factory. It lets you test connection
// factory decorators by standing in for a connection
// factory and letting you later retrieve the URL that
// the factory was invoked with, or values sent.
exports.createConnFactoryMock = createConnFactoryMock;
function createConnFactoryMock(robust) {
  var conn = null;
  var self = {
    factory: function(url, ctx, callback) {
      conn = new MockConnection(this, url, ctx, true, robust);
      self.onConnCreate(conn);
      setTimeout(function() {
        callback(null, conn);
      }, 0);
    },
    getConn: function() {
      return conn
    },
    // User-overrideable callback
    onConnCreate: function(conn) {}
  };
  return self;
};

function MockConnection(parent, url, ctx, open, robust) {
  var self = this;
  this._parent = parent;
  this.url = url;
  this.ctx = ctx;
  this.robust = robust;
  this.sendContinue = false;
  this.log = [];
  this.onopen = this.onclose = this.onmessage = this.onerror = function() {};
  this.readyState = WebSocket.CONNECTING;

  if (open) {
    setTimeout(function() {
      if (self.readyState === WebSocket.CONNECTING) {
        self.readyState = WebSocket.OPEN;
        self.onopen(util.createEvent("open"));
        if (self.robust && self.sendContinue) {
          self.onmessage({
            data: "CONTINUE " + (self._parent.nextId || 0).toString(16).toUpperCase()
          });
        }
      }
    }, 10);
  }
}

MockConnection.prototype.send = function(data) {
  if (this.robust) {
    var cont = message_utils.parseCONTINUE(data) !== null;
    var ack = message_utils.parseACK(data) !== null;
    var msg = message_utils.parseTag(data);

    if (!cont && !ack && !msg) {
      throw new Error("Message was not robustified: " + data);
    }
    if (msg)
      this._parent.nextId = msg.id + 1;
  }
  this.log.push({type: "send", data: data});
};
MockConnection.prototype.close = function(code, reason, wasClean) {
  this.log.push({type: "close", data: {code: code, reason: reason, wasClean: wasClean}});
  this.readyState = WebSocket.CLOSED;
  this.onclose({
    code: code,
    reason: reason,
    wasClean: wasClean
  });
};
