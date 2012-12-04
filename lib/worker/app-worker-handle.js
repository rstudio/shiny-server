var events = require('events');
var util = require('util');

var AppWorkerHandle = function(appSpec, port, logFilePath, exitPromise) {
  events.EventEmitter.call(this);
  this.appSpec = appSpec;
  this.port = port;
  this.logFilePath = logFilePath;
  this.exitPromise = exitPromise;

  this.$refCount = 0;
};
module.exports = AppWorkerHandle;

util.inherits(AppWorkerHandle, events.EventEmitter);

(function() {

  /**
   * Increment reference count.
   *
   * Call when a client is using this worker. This prevents the worker from
   * being reaped. Call release() when the client is done using the worker.
   */
  this.acquire = function() {
    this.$refCount++;
    logger.trace('Port ' + this.port + ' acquired: ' + this.$refCount);
    this.emit('acquire', this.$refCount);
  };

  /**
   * Decrement reference count.
   *
   * Call when a client is done using this worker. This allows the worker to
   * potentially be reaped if the refcount is zero.
   */
  this.release = function() {
    this.$refCount--;
    logger.trace('Port ' + this.port + ' released: ' + this.$refCount);
    this.emit('release', this.$refCount);
  };

}).call(AppWorkerHandle.prototype);