let util = require('../util');

// The job of this decorator is to request a token from
// the server, and append that to the URL.
//
// * Writes to ctx: nothing
// * Reads from ctx: nothing
exports.decorate = function(factory, options) {
  return function(url, ctx, callback) {
    if (!exports.ajax) {
      throw new Error("No HTTP transport was provided");
    }

    let xhr = exports.ajax("__token__", {
      type: "GET",
      cache: false,
      dataType: "text",
      success: function(data, textStatus) {
        let newUrl = util.addPathParams(url, {"t": data});
        factory(newUrl, ctx, callback);
      },
      error: function(jqXHR, textStatus, errorThrown) {
        callback(errorThrown);
      }
    });
  };
};

// Override this to mock.
exports.ajax = null;
if (typeof(jQuery) !== "undefined") {
  exports.ajax = jQuery.ajax;
}
