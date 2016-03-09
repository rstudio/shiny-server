"use strict";

const assert = require("chai").assert;

const debug = require("../lib/debug");
const log = require("../lib/log");
const multiplex = require("../lib/decorators/multiplex");

const ConnectionContext = require("../lib/decorators/connection-context");

const common = require("./common");

// Squelch log/debug messages during tests
let logSuppress;
let debugSuppress;
before(() => {
  logSuppress = log.suppress;
  log.suppress = true;
  debugSuppress = debug.suppress;
  debug.suppress = true;
});
after(() => {
  log.suppress = logSuppress;
  debug.suppress = debugSuppress;
});

describe("Multiplex decorator", () => {
  let fm = common.createConnFactoryMock(false);
  let factory = multiplex.decorate(fm.factory, {});

  it("adds expected info to ctx", function(done) {
    let ctx = new ConnectionContext();
    factory("/foo/bar", ctx, function(err, conn) {
      if (err) {
        throw err;
      }

      assert.equal(fm.getConn().url, "/foo/bar");
      assert.equal(typeof(ctx.multiplexClient.open), "function");
      done();
    });
  });

  it("implements multiplex protocol", function(done) {
    let ctx = new ConnectionContext();
    factory("/foo/bar", ctx, function(err, conn) {
      if (err) {
        throw err;
      }

      let childConn1 = ctx.multiplexClient.open("/subapp1");

      conn.onopen = () => {
        conn.send("Hello world!");
        setTimeout(() => {
          conn.close(3000, "Done for the day.");
          childConn1.close(3001, "Gone fishing.");
        }, 0);
      };

      setTimeout(() => {
        assert.equal(
          JSON.stringify(fm.getConn().log),
          JSON.stringify(
            [ { type: 'send', data: '0|o|' },
              { type: 'send', data: '0|m|Hello world!' },
              { type: 'send', data: '1|o|/subapp1/s=1' },
              { type: 'send', data: '0|c|{\"code\":3000,\"reason\":\"Done for the day.\"}' },
              { type: 'send', data: '1|c|{\"code\":3001,\"reason\":\"Gone fishing.\"}' },
              { type: 'close', data: {}} ]
          )
        );
        done();
      }, 200);
    });
  });
});
