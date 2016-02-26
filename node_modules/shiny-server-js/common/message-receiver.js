// No ES6 allowed in this directory!

var message_utils = require("./message-utils");

module.exports = MessageReceiver;
function MessageReceiver(ackTimeout) {
  this._pendingMsgId = 0;
  this._ackTimer = null;
  this._ackTimeout = ackTimeout || 2000;

  // This should be set by clients
  this.onacktimeout = function(e) {};
}

MessageReceiver.parseId = parseId;
function parseId(str) {
  return parseInt(str, 16);
}

MessageReceiver.prototype.receive = function(msg) {
  var self = this;

  var result = message_utils.parseTag(msg);
  if (!result) {
    throw new Error("Invalid robust-message, no msg-id found");
  }

  this._pendingMsgId = result.id;

  if (!this._ackTimer) {
    this._ackTimer = setTimeout(function() {
      self._ackTimer = null;
      self.onacktimeout({messageId: self._pendingMessageId});
    }, this._ackTimeout);
  }

  return result.data;
};

MessageReceiver.prototype.nextId = function() {
  return this._pendingMsgId;
};

MessageReceiver.prototype.ACK = function() {
  return "ACK " + message_utils.formatId(this._pendingMsgId);
};

MessageReceiver.prototype.CONTINUE = function() {
  return "CONTINUE " + message_utils.formatId(this._pendingMsgId);
};
