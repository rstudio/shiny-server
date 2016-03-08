"use strict";

const EventEmitter = require("events").EventEmitter;
const inherits = require("inherits");

module.exports = ConnectionContext;

function ConnectionContext() {
  EventEmitter.call(this);
}
inherits(ConnectionContext, EventEmitter);
