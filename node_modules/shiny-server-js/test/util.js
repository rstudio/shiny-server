"use strict";

const assert = require("chai").assert;

const util = require("../lib/util");

describe("Nice backoff", function() {
  it("is nice", function() {
    let func = util.createNiceBackoffDelayFunc();
    let results = [];
    for (let i = 0; i < 10; i++) {
      results.push(func());
    }
    assert.deepEqual(results, [0, 1000, 2000, 3000, 5000, 5000, 5000, 5000, 5000, 5000]);
  });
});
