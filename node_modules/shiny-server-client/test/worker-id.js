"use strict";

const assert = require("chai").assert;

const ConnectionContext = require("../lib/decorators/connection-context");
const workerId = require("../lib/decorators/worker-id");
const common = require("./common");

let oldLocation;

before(() => {
  oldLocation = global.location;
  global.location = {
    search: "?foo=bar&w=deadbeef123&baz=qux"
  };
});

// Restore old token
after(() => {
  global.location = oldLocation;
});

describe("Worker ID decorator", () => {
  it("adds worker ID from URL search", function(done) {
    let fm = common.createConnFactoryMock(false);

    let factory = workerId.decorate(fm.factory);

    factory("/foo/bar", new ConnectionContext(), function(err, conn) {
      if (err) {
        throw err;
      }

      assert.equal(fm.getConn().url, "/foo/bar/w=deadbeef123");
      done();
    });
  });
});
