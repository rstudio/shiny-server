module.exports = function(msg) {
  if (typeof(console) !== "undefined" && !module.exports.suppress) {
    console.log(new Date() + " [DBG]: " + msg);
  }
};

module.exports.suppress = false;
