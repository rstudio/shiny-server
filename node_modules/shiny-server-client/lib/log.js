/*eslint-disable no-console*/
"use strict";

module.exports = function(msg) {
  if (typeof(console) !== "undefined" && !module.exports.suppress) {
    console.log(new Date() + " [INF]: " + msg);
  }
};

module.exports.suppress = false;
