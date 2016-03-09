"use strict";

const pathParams = require("../../common/path-params");

// The job of this decorator is to add the worker ID
// to the connection URL.
//
// In the future, this will not only read the worker
// ID from the current URL, but also go get a new
// worker ID if we're in a reconnect scenario.
//
// * Writes to ctx: nothing
// * Reads from ctx: nothing
exports.decorate = function(factory, options) {
  return function(url, ctx, callback) {
    if (!global.location) {
      // Pass-through if we're neither in a browser
      // nor have a mocked location
      return factory(url, ctx, callback);
    }

    // Search for the worker ID either in the URL query string,
    // or in the <base href> element

    let search = global.location.search.replace(/^\?/, '');
    let worker = '';
    if (search.match(/\bw=[^&]+/)){
      worker = search.match(/\bw=[^&]+/)[0].substring(2);
    }

    // TODO: Dynamic workerId for reconnection case

    if (!worker) {
      // Check to see if we were assigned a base href
      let base = global.jQuery('base').attr('href');
      // Extract the worker ID if it's included in a larger URL.
      let mtch = base.match(/_w_(\w+)\//);
      base = mtch[1];
      if (base) {
        // Trim trailing slash
        base = base.replace(/\/$/, '');
        base = base.replace(/^_w_/, '');
        worker = base;
      }
    }

    if (worker) {
      url = pathParams.addPathParams(url, {"w": worker});
    }
    return factory(url, ctx, callback);
  };
};
