// No ES6 allowed in this directory!

var message_utils = require("./message-utils");

module.exports = MessageReceiver;
function MessageReceiver() {
  this._pendingMsgId = 0;
}

MessageReceiver.parseId = parseId;
function parseId(str) {
  return parseInt(str, 16);
}

MessageReceiver.prototype.receive = function(msg) {
  var result = message_utils.parseTag(msg);
  if (!result) {
    throw new Error("Invalid robust-message, no msg-id found");
  }

  this._pendingMsgId = result.id;

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
