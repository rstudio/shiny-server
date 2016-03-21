"use strict";

const assert = require("chai").assert;
const TrivialConnection = require("./common").TrivialConnection;
const ConnectionContext = require("../lib/decorators/connection-context");

const extendSession = require("../lib/decorators/extend-session");

describe("extend-session", () => {
  let requestCount = 0;

  let jQueryOrig;
  before(() => {
    jQueryOrig = global.jQuery;
    global.jQuery = {
      ajax: () => {
        requestCount++;
        let self = {
          done: () => self,
          fail: () => self
        };
        return self;
      }
    };
  });
  after(() => {
    global.jQuery = jQueryOrig;
  });

  let options = {extendSessionInterval: 10};

  function factory(url, ctx, callback) {
    callback(null, new TrivialConnection());
  }

  it("works", done => {
    extendSession.decorate(factory, options)("", new ConnectionContext(), (err, conn) => {
      assert(!err);
      setTimeout(() => {
        assert(requestCount > 0);
        let savedRequestCount = requestCount;
        conn.close();
        // Ensure that after close(), no more requests are sent
        setTimeout(() => {
          assert.equal(savedRequestCount, requestCount);
          done();
        }, 100);
      }, 100);
    });
  });
});
