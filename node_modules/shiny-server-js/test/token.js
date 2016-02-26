var assert = require("chai").assert;

var token = require("../lib/decorators/token");
var common = require("./common");

var oldAjax;

// Hijack the ajax requestor to always return "fizzbuzz"
// on __token__ request
before(function() {
  oldAjax = token.ajax;
  token.ajax = function(url, options) {
    setTimeout(function() {
      if (url === "__token__") {
        options.success("fizzbuzz", "OK");
      } else {
        options.error(null, "Not Found", new Error("Unknown URL"));
      }
  }, 0);
  };
});

// Restore old token
after(function() {
  token.ajax = oldAjax;
});

describe("Token decorator", function() {
  it("adds token path-param", function(done) {
    var fm = common.createConnFactoryMock(false);

    var factory = token.decorate(fm.factory);

    factory("/foo/bar", {}, function(err, conn) {
      if (err) {
        throw err;
      }

      assert.equal(fm.getConn().url, "/foo/bar/t=fizzbuzz");
      done();
    });
  });
});
