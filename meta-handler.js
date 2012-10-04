var DoublyLinkedList = require('./doubly-linked-list').DoublyLinkedList;

var MetaHandler = function() {
  this.$handlers = new DoublyLinkedList();
};

MetaHandler.prototype.push = function(handler) {
  if (!handler)
    throw "Invalid handler value";

  return this.$handlers.push(handler);
};

MetaHandler.prototype.getHandler = function() {
  var handlers = this.$handlers;

  return function() {
    var self = this;
    var args = arguments;
    
    var handled = !handlers.iterate(function(i, value) {
      if (value.apply(self, args))
        return false; // stop the iteration
    });

    return handled;
  };
};

exports.MetaHandler = MetaHandler;
