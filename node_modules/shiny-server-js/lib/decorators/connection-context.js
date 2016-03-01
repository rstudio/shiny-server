const EventEmitter = require("events");
const inherits = require("inherits");

module.exports = ConnectionContext;

function ConnectionContext() {
  EventEmitter.call(this);
}
inherits(ConnectionContext, EventEmitter);
