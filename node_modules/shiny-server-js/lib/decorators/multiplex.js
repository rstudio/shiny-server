let MultiplexClient = require("../multiplex-client");

var util = require("../util");
var PromisedConnection = require("../promised-connection");
const pathParams = require("../../common/path-params");

// The job of this decorator is to wrap the underlying
// connection with our Multiplexing protocol, designed
// to allow multiple iframes to share the same connection
// on the client but proxy out to multiple sessions on
// the server. This decorator provides the "primary"
// multiplex channel, i.e. the one from the outermost
// webpage/frame.
//
// * Writes to ctx: multiplexClient (MultiplexClient)
// * Reads from ctx: params
exports.decorate = function(factory, options) {
  return function(url, ctx, callback) {

    let multiplexClientPromise = util.promise();

    url = pathParams.addPathParams(url, {s: 0});
    ctx.params.s = 0;

    ctx.multiplexClient = {
      open: url => {
        let pc = new PromisedConnection();
        multiplexClientPromise.then(
          client => {
            // Clone ctx.params so we don't alter the original
            let params = JSON.parse(JSON.stringify(ctx.params));
            // Change s=0 to s=1
            if (typeof(params.s) !== "undefined")
              params.s = "1";

            let urlWithParams = pathParams.addPathParams(url, params);
            urlWithParams = pathParams.reorderPathParams(urlWithParams, ["n", "o", "t", "w", "s"]);

            pc.resolve(null, client.open(urlWithParams));
          }
        ).then(
          null,
          err => {
            pc.resolve(err);
          }
        );

        return pc;
      }
    };

    return factory(url, ctx, function(err, conn) {
      if (err) {
        callback(err);
        return;
      }

      let m = /\/([^\/]+)$/.exec(global.location.pathname);
      let relUrl = m ? m[1] : "";
      // if (relUrl !== "") {
      //   relUrl = pathParams.addPathParams(relUrl, ctx.params);
      //   relUrl = pathParams.reorderPathParams(relUrl, ["n", "o", "t", "w", "s"]);
      // }

      try {
        let client = new MultiplexClient(conn);
        callback(null, client.open(relUrl));
        multiplexClientPromise(true, [client]);
      } catch(e) {
        multiplexClientPromise(false, [e]);
        callback(e);
      }
    });
  };
};
