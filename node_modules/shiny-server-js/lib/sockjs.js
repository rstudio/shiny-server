let util = require("./util");

let log = require("./log");

let disabled = false;
let currConn = null;

global.__shinyserverdebug__ = {
  interrupt: function() {
    log("OK, we'll silently drop messages starting now.")
    currConn.send = function(data) {
      log("Dropping message " + data);
    };
    currConn.onmessage = function(e) {
      log("Ignoring message " + e.data);
    };
  },
  disconnect: function() {
    log("OK, we'll simulate a disconnection.");
    // 4567 is magic code number that tells the reconnect
    // decorator to try reconnecting, which we normally
    // only do on !wasClean disconnects.
    currConn.close(4567);
  },
  disableServer: function() {
    disabled = true;
  }
};

exports.createFactory = function(options) {
  return function(url, context, callback) {
    if (!callback) throw new Error("callback is required");

    let conn = new SockJS(url, null, options);
    currConn = conn;

    callback(null, conn);
  };
};
