var assert = require("chai").assert;

var pathParams = require("../common/path-params");

var reconnect = require("../lib/decorators/reconnect");
var util = require("../lib/util");
var WebSocket = require("../lib/websocket");
var ConnectionContext = require("../lib/decorators/connection-context");
var common = require("./common");

describe("Reconnect decorator", function() {

  function createTestFactory() {
    var connFactoryMock = common.createConnFactoryMock(true);

    var factory = function(url, ctx, callback) {
      // Randomize the URL a bit, so we can distinguish physical
      // connections from each other.
      url = pathParams.addPathParams(url, {rnd: Math.round(Math.random()*1e12)});
      connFactoryMock.factory(url, ctx, callback);
    };
    return {
      factory: reconnect.decorate(factory, {reconnectTimeout: 100}),
      fm: connFactoryMock
    };
  }

  it("reconnects", function(done) {
    var setup = createTestFactory();
    setup.factory("/foo/bar", new ConnectionContext(), function(err, conn) {
      if (err) {
        throw err;
      }

      // The physical connection hasn't connected yet.
      assert.equal(conn.readyState, WebSocket.CONNECTING);

      conn.onopen = function() {
        // Physical connection has connected.
        assert.equal(conn.readyState, WebSocket.OPEN);

        var origConn = setup.fm.getConn();

        // Killing the physical connection doesn't cause the logical
        // connection to close.
        setup.fm.getConn().close(1005, "", false); // wasClean == false
        assert.equal(conn.readyState, WebSocket.OPEN);

        setTimeout(function() {
          assert.equal(conn.readyState, WebSocket.OPEN);
          assert.equal(setup.fm.getConn().readyState, WebSocket.OPEN);

          // Check to ensure the physical connection has been replaced.
          assert.notEqual(origConn, setup.fm.getConn());
          assert.notEqual(origConn.url, setup.fm.getConn().url);

          conn.close();
          assert.equal(conn.readyState, WebSocket.CLOSED);

          done();
        }, 50);
      };
    });
  });

  it("failure on initial connection doesn't trigger retry", function(done) {
    // If initial connection attempt fails, then the connection should
    // immediately close.

    var setup = createTestFactory();

    var connectionCount = 0;
    setup.fm.onConnCreate = function(mockConn) {
      connectionCount++;
      mockConn.sendContinue = connectionCount > 1;
      mockConn.close(1005, "", false); // wasClean == false
    };

    setup.factory("/foo/bar", new ConnectionContext(), function(err, conn) {
      if (err) {
        throw err;
      }

      var openWasCalled = false;
      var errorWasCalled = false;
      var closeWasCalled = false;

      conn.onopen = function() { openWasCalled = true; };
      conn.onerror = function() { errorWasCalled = true; };
      conn.onclose = function() { closeWasCalled = true; };

      setTimeout(function() {
        assert.equal(conn.readyState, WebSocket.CLOSED);
        assert.equal(connectionCount, 1);
        assert.equal(openWasCalled, false);
        assert.equal(errorWasCalled, true);
        assert.equal(closeWasCalled, true);
        done();
      }, 50);
    });
  });


  it("permanent failure behavior", function(done) {
    // Allow connection, then close the underlying conn and
    // force all future conn attempts to fail

    this.timeout(20000);

    var setup = createTestFactory();

    var connectionCount = 0;
    setup.fm.onConnCreate = function(mockConn) {
      connectionCount++;
      // Attempts at initial connection should have an n= URL
      // path parameter; attempts at reconnect should have o=
      // instead.
      if (connectionCount > 1) {
        assert.match(mockConn.url, /\bo=/);
        assert.notMatch(mockConn.url, /\bn=/);

        // For this test, we only let the first conn attempt
        // succeed.
        mockConn.close(1005, "", false); // wasClean == false
      } else {
        assert.match(mockConn.url, /\bn=/);
        assert.notMatch(mockConn.url, /\bo=/);
      }
    };

    setup.factory("/foo/bar", new ConnectionContext(), function(err, conn) {
      if (err) {
        throw err;
      }

      var openWasCalled = false;
      var errorWasCalled = false;
      var closeWasCalled = false;

      conn.onopen = function() { openWasCalled = true; };
      conn.onerror = function() { errorWasCalled = true; };
      conn.onclose = function() { closeWasCalled = true; done(); };

      setTimeout(function() {
        assert.equal(conn.readyState, WebSocket.OPEN);
        assert.equal(setup.fm.getConn().readyState, WebSocket.OPEN);
        setup.fm.getConn().close(1005, "", false);
      }, 1000);

    });
  });

  it("prepends message numbers", function(done) {
    var setup = createTestFactory();
    setup.factory("/foo/bar", new ConnectionContext(), function(err, conn) {
      if (err) {
        throw err;
      }

      conn.onopen = function() {
        conn.send("a");
        conn.send("b");
        conn.send("c");
        conn.send("d");
        conn.send("e");
        conn.send("f");
        conn.send("g");
        conn.send("h");
        conn.send("i");
        conn.send("j");
        conn.send("k");
        assert.deepEqual(
          setup.fm.getConn().log[10],
          { type: 'send', data: 'A#k' }
        );
        done();
      };
    });
  });
});
