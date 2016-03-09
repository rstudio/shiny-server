"use strict";

const MultiplexClient = require("../multiplex-client");

const util = require("../util");
const PromisedConnection = require("../promised-connection");
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
// * Reads from ctx: nothing
exports.decorate = function(factory, options) {
  return function(url, ctx, callback) {

    let multiplexClientPromise = util.promise();

    if (options.subappTag) {
      url = pathParams.addPathParams(url, {s: 0});
    }

    ctx.multiplexClient = {
      open: relUrl => {
        let pc = new PromisedConnection();
        multiplexClientPromise.then(
          client => {
            let urlWithParams = pathParams.addPathParams(relUrl, {s: 1});
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
