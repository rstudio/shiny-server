const EventEmitter = require("events").EventEmitter;
const inherits = require("inherits");

module.exports = ConnectionContext;

function ConnectionContext() {
  EventEmitter.call(this);

  this.params = {};
}
inherits(ConnectionContext, EventEmitter);
