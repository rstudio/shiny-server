var assert = require("chai").assert;

var util = require("../lib/util");

describe("Nice backoff", function() {
  it("is nice", function() {
    var func = util.createNiceBackoffDelayFunc();
    var results = [];
    for (var i = 0; i < 10; i++) {
      results.push(func());
    }
    assert.deepEqual(results, [0, 1000, 2000, 3000, 5000, 5000, 5000, 5000, 5000, 5000]);
  });
});
