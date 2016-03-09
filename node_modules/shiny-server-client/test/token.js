"use strict";

const assert = require("chai").assert;

const ConnectionContext = require("../lib/decorators/connection-context");
const token = require("../lib/decorators/token");
const common = require("./common");

let oldAjax;

// Hijack the ajax requestor to always return "fizzbuzz"
// on __token__ request
before(() => {
  oldAjax = token.ajax;
  token.ajax = function(url, options) {
    setTimeout(() => {
      if (url === "__token__") {
        options.success("fizzbuzz", "OK");
      } else {
        options.error(null, "Not Found", new Error("Unknown URL"));
      }
  }, 0);
  };
});

// Restore old token
after(() => {
  token.ajax = oldAjax;
});

describe("Token decorator", () => {
  it("adds token path-param", function(done) {
    let fm = common.createConnFactoryMock(false);

    let factory = token.decorate(fm.factory);

    factory("/foo/bar", new ConnectionContext(), function(err, conn) {
      if (err) {
        throw err;
      }

      assert.equal(fm.getConn().url, "/foo/bar/t=fizzbuzz");
      done();
    });
  });
});
