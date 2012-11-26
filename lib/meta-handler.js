//
// meta-handler.js
//
// Copyright (C) 2009-12 by RStudio, Inc.
//
// This program is licensed to you under the terms of version 3 of the
// GNU Affero General Public License. This program is distributed WITHOUT
// ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
// AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
//
var DoublyLinkedList = require('./doubly-linked-list').DoublyLinkedList;

var MetaHandler = function() {
  this._handlers = new DoublyLinkedList();
};

MetaHandler.prototype.push = function(handler) {
  if (!handler)
    throw "Invalid handler value";

  return this._handlers.push(handler);
};

MetaHandler.prototype.getHandler = function() {
  var handlers = this._handlers;

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
