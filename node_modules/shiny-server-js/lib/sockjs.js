var util = require("./util");

var log = require("./log");

exports.createFactory = function(options) {
  return function(url, context, callback) {
    if (!callback) throw new Error("callback is required");

    var conn = new SockJS(url, null, options);

    global.__shinyserverdebug__ = {
      interrupt: function() {
        log("OK, we'll silently drop messages starting now.")
        conn.send = function(data) {
          log("Dropping message " + data);
        };
        conn.onmessage = function(e) {
          log("Ignoring message " + e.data);
        };
      },
      disconnect: function() {
        log("OK, we'll simulate a disconnection.");
        // 4567 is magic code number that tells the reconnect
        // decorator to try reconnecting, which we normally
        // only do on !wasClean disconnects.
        conn.close(4567);
      }
    };

    callback(null, conn);
  };
};
