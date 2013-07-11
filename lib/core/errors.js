var util = require('util')

/**
 * Concept derived from Dustin Senos.
 * http://dustinsenos.com/articles/customErrorsInNode
**/
var AbstractError = function (msg, constr) {
  Error.captureStackTrace(this, constr || this);
  this.message = msg || 'Error';
};
util.inherits(AbstractError, Error);
AbstractError.prototype.name = 'Abstract Error';

var OutOfCapacityError = function (msg) {
  OutOfCapacityError.super_.call(this, msg, this.constructor);
}
util.inherits(OutOfCapacityError, AbstractError);
OutOfCapacityError.prototype.name = 'Out Of Capacity Error';

module.exports = {
  OutOfCapacity: OutOfCapacityError
}