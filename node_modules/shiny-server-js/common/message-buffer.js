// No ES6 allowed in this directory!

var message_utils = require("./message-utils");

module.exports = MessageBuffer;
function MessageBuffer() {
  this._messages = [];
  this._startIndex = 0;
  this._messageId = 0;
}

MessageBuffer.prototype.write = function(msg) {
  msg = message_utils.formatId(this._messageId++) + "#" + msg;
  this._messages.push(msg);
  return msg;
};

MessageBuffer.prototype.handleACK = function(msg) {
  var ackId = message_utils.parseACK(msg);
  if (ackId === null) {
    return -1;
  }
  return this.discard(ackId);
};

// Returns the number of messages that were actually
// discarded.
//
// Can throw an error, if nextId is outside of the valid range.
MessageBuffer.prototype.discard = function(nextId) {
  // The message ID they send is the first id *not* seen by
  // their side (and not the last id seen by them). This is
  // not intuitive, but it makes it possible to indicate
  // no messages seen ("0") and makes the indexing math a
  // bit cleaner as well.
  var keepIdx = nextId - this._startIndex;
  if (keepIdx < 0) {
    throw new Error("Discard position id too small");
  }
  if (keepIdx > this._messages.length) {
    throw new Error("Discard position id too big");
  }
  this._messages = this._messages.slice(keepIdx);
  this._startIndex = nextId;
  return keepIdx;  // equal to the number of messages we dropped
};

MessageBuffer.prototype.nextId = function() {
  return this._messageId;
};

// Can throw an error, if startId is outside of the valid range.
MessageBuffer.prototype.getMessagesFrom = function(startId) {
  var from = startId - this._startIndex;
  if (from < 0) {
    throw new Error("Message buffer underrun detected")
  }
  if (from > this._messages.length) {
    throw new Error("Message id larger than expected")
  }

  return this._messages.slice(from);
};
