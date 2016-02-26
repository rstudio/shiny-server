var MultiplexClient = require("../multiplex-client");

// The job of this decorator is to wrap the underlying
// connection with our Multiplexing protocol, designed
// to allow multiple iframes to share the same connection
// on the client but proxy out to multiple sessions on
// the server. This decorator provides the "primary"
// multiplex channel, i.e. the one from the outermost
// webpage/frame.
//
// * Writes to ctx: multiplexClient (MultiplexClient)
// * Reads from ctx: nothing
exports.decorate = function(factory, options) {
  return function(url, ctx, callback) {
    return factory(url, ctx, function(err, conn) {
      if (err) {
        callback(err);
        return;
      }

      try {
        var client = new MultiplexClient(conn);
        ctx.multiplexClient = client;
        callback(null, client.open(""));
      } catch(e) {
        callback(e);
      }
    });
  };
};
