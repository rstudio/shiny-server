//
// doubly-linked-list.js
//
// Copyright (C) 2009-12 by RStudio, Inc.
//
// This program is licensed to you under the terms of version 3 of the
// GNU Affero General Public License. This program is distributed WITHOUT
// ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
// AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
//
var ListNode = function(value) {

  // Points to the next node in the list. If null, we're the tail.
  this.next = null;

  // Points to the previous node of the list. If we're in a list (and not the
  // head) then this should always be non-null.
  this.prev = null;

  // The actual value of this node.
  this.value = value;
};

// Pretty standard doubly linked list.
// O(1) operations: unshift, push, _remove
// O(n) operations: iterate, clear
var DoublyLinkedList = function() {
  // The head of the list is always this dummy node; this makes for a cleaner
  // implementation than having the head be null when the list is empty, since
  // then we have to go around checking for null all the time. Just need to
  // always ignore the head node when iterating or counting.
  this._head = new ListNode(null);
  this._tail = this._head;
};

// Call to iterate over the values in the list. The callback function will be
// invoked once for each value; the first argument is the index in the list,
// the second argument is the value itself. You can also use the `this` keyword
// in the callback function to access the value, but Javascript will always
// wrap the this value as an Object even if it is a simple string or number
// value.
// 
// Return `false` from the callback function to halt iteration (note: other
// "falsy" values, including `undefined`, will not halt iteration).
//
// This function returns true if iteration completed, or false if it halted
// early.
//
// (Note on naming: I called this `iterate` instead of the more obvious `each`
// or `foreach` because the semantics are different than `jQuery.each` and
// `Array.forEach`.)
DoublyLinkedList.prototype.iterate = function(func) {
  for (var node = this._head.next, i = 0; node; node = node.next, i += 1) {
    if (func.call(node.value, i, node.value) === false)
      return false;
  }
  return true;
};

DoublyLinkedList.prototype.clear = function() {
  // Would be more efficient to blank out all the nodes right here, but this
  // way is easier to read and maintain.
  //
  // Another easy thing to do would be to just run the constructor again,
  // without clearing out the fields of each of the list nodes. If we decide
  // to do that (to make clearing an O(1) operation) it'd be necessary to
  // do more work to make sure _remove doesn't mutate the list incorrectly
  // when passed an orphaned node.
  while (this._tail !== this._head)
    this._remove(this._tail);
};

DoublyLinkedList.prototype.unshift = function(value) {
  var node = new ListNode(value);

  node.next = this._head.next;
  node.prev = this._head;
  this._head.next = node;

  if (node.next) {
    // List is not empty.
    node.next.prev = node;
  } else {
    // List is empty.
    this._tail = node;
  }
};

// Call to add a value to the end of the list. The return value is a function
// which takes no arguments, that can be called to remove the value from the
// list.
DoublyLinkedList.prototype.push = function(value) {
  var node = new ListNode(value);

  // Make the tail point to us, then make us the new tail.

  // assert(this._tail.next === null)
  this._tail.next = node;
  node.prev = this._tail;

  this._tail = node;

  var self = this;
  return function() {
    self._remove(node);
  };
};

DoublyLinkedList.prototype._remove = function(node) {
  // Check if already removed; if so, no-op
  if (!node.prev)
    return;

  // Link previous node to next node
  node.prev.next = node.next;

  if (node.next != null) {
    // Link next node to previous node...
    node.next.prev = node.prev;
  }
  else {
    // ...unless there is no next node, in which case, node was the tail and
    // now the previous node is the new tail
    this._tail = node.prev;
  }

  node.prev = null;
  node.next = null;
};

exports.DoublyLinkedList = DoublyLinkedList;
