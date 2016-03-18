"use strict";

const log = require("./log");
const pathParams = require("../common/path-params");

let currConn = null;

global.__shinyserverdebug__ = {
  interrupt: function() {
    log("OK, we'll silently drop messages starting now.");
    currConn.send = function(data) {
      log("Dropping message " + data);
    };
    currConn.onmessage = function(e) {
      log("Ignoring message " + e.data);
    };
  },
  disconnect: function() {
    log("OK, we'll simulate a disconnection.");
    // 46xx range for close code tells the reconnect
    // decorator to try reconnecting, which we normally
    // only do on !wasClean disconnects.
    currConn.close(4600);
  }
};

// options.disableProtocols can be an array of protocols to remove from the
// whitelist
exports.createFactory = function(options) {
  return function(url, context, callback) {
    if (!callback) throw new Error("callback is required");

    url = pathParams.reorderPathParams(url, ["n", "o", "t", "w", "s"]);

    let whitelist = [];
    require("./protocol-chooser").whitelist.forEach(prot => {
      if (!options.disableProtocols || options.disableProtocols.indexOf(prot) < 0) {
        whitelist.push(prot);
      }
    });

    let conn = new global.SockJS(url, null, {
      protocols_whitelist: whitelist
    });
    currConn = conn;

    callback(null, conn);
  };
};
