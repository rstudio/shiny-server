"use strict";

const BaseConnectionDecorator = require("./base-connection-decorator");
const debug = require("../debug");

function extendSession() {
  global.jQuery.ajax("__extendsession__", {type:"POST", async: true})
    .done(() => {
      debug("__extendsession__ succeeded");
    })
    .fail(() => {
      debug("__extendsession__ failed");
    });
}

// Sends __extendsession__ requests repeatedly while connection to the server
// exists. This keeps the session alive by causing the cookies to be refreshed.
//
// * Writes to ctx: nothing
// * Reads from ctx: nothing
exports.decorate = function(factory, options) {
  return function(url, ctx, callback) {
    let duration = options.extendSessionInterval || 5*1000;

    // Use this interval-id to shut down the interval when we lose our
    // connection to the server.
    let handle = null;

    factory(url, ctx, function(err, conn) {
      if (!err) {
        handle = setInterval(extendSession, duration);
      }

      // Pass through the connection except clear the extendSessionInterval on
      // close.
      let wrapper = new BaseConnectionDecorator(conn);
      conn.onclose = function() {
        clearInterval(handle);
        handle = null;
        if (wrapper.onclose)
          wrapper.onclose.apply(wrapper, arguments);
      };

      callback(err, wrapper);
    });
  };
};
