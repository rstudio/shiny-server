const BaseConnectionDecorator = require("./base-connection-decorator");
const debug = require("../debug");

function extendSession() {
  global.jQuery.ajax("__extendsession__", {type:"POST", async: true})
    .done(_ => {
      debug("__extendsession__ succeeded");
    })
    .fail(_ => {
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

    // Use this interval-id to shut down the interval when we lose our
    // connection to the server.
    let extendSessionInterval = null;

    factory(url, ctx, function(err, conn) {
      if (!err) {
        extendSessionInterval = setInterval(extendSession, 5*1000);
      }

      // Pass through the connection except clear the extendSessionInterval on
      // close.
      let wrapper = new BaseConnectionDecorator(conn);
      conn.onclose = function() {
        clearInterval(extendSessionInterval);
        extendSessionInterval = null;
        if (wrapper.onclose)
          wrapper.onclose.apply(wrapper, arguments);
      };

      callback(err, wrapper);
    });
  };
};
