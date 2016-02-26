var assert = require("chai").assert;

var debug = require("../lib/debug");
var log = require("../lib/log");
var multiplex = require("../lib/decorators/multiplex");
var util = require("../lib/util");

var common = require("./common");

// Squelch log/debug messages during tests
var logSuppress;
var debugSuppress;
before(function() {
  var logSuppress = log.suppress;
  log.suppress = true;
  var debugSuppress = debug.suppress;
  debug.suppress = true;
});
after(function() {
  log.suppress = logSuppress;
  debug.suppress = debugSuppress;
});

describe("Multiplex decorator", function() {
  var fm = common.createConnFactoryMock(false);
  var factory = multiplex.decorate(fm.factory);

  it("adds expected info to ctx", function(done) {
    var ctx = {};
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
    var ctx = {};
    factory("/foo/bar", ctx, function(err, conn) {
      if (err) {
        throw err;
      }
      
      var childConn1 = ctx.multiplexClient.open("/subapp1");

      conn.onopen = function() {
        conn.send("Hello world!");
        setTimeout(function() {
          conn.close(3000, "Done for the day.");
          childConn1.close(3001, "Gone fishing.");
        }, 0);
      };

      setTimeout(function() {
        assert.equal(
          JSON.stringify(ctx.multiplexClient._conn.log),
          JSON.stringify(
            [ { type: 'send', data: '0|o|' },
              { type: 'send', data: '0|m|Hello world!' },
              { type: 'send', data: '1|o|/subapp1' },
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
