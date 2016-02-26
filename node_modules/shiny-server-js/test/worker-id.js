var assert = require("chai").assert;

var workerId = require("../lib/decorators/worker-id");
var common = require("./common");

var oldLocation;

before(function() {
  oldLocation = global.location;
  global.location = {
    search: "?foo=bar&w=deadbeef123&baz=qux"
  };
});

// Restore old token
after(function() {
  global.location = oldLocation;
});

describe("Worker ID decorator", function() {
  it("adds worker ID from URL search", function(done) {
    var fm = common.createConnFactoryMock(false);

    var factory = workerId.decorate(fm.factory);

    factory("/foo/bar", {}, function(err, conn) {
      if (err) {
        throw err;
      }

      assert.equal(fm.getConn().url, "/foo/bar/w=deadbeef123");
      done();
    });
  });
});
