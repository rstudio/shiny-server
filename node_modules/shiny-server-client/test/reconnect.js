"use strict";

const assert = require("chai").assert;

const pathParams = require("../common/path-params");

const reconnect = require("../lib/decorators/reconnect");
const WebSocket = require("../lib/websocket");
const ConnectionContext = require("../lib/decorators/connection-context");
const common = require("./common");

describe("Reconnect decorator", () => {

  function createTestFactory() {
    let connFactoryMock = common.createConnFactoryMock(true);

    let factory = function(url, ctx, callback) {
      // Randomize the URL a bit, so we can distinguish physical
      // connections from each other.
      url = pathParams.addPathParams(url, {rnd: Math.round(Math.random()*1e12)});
      connFactoryMock.factory(url, ctx, callback);
    };
    return {
      factory: reconnect.decorate(factory, {
        reconnectTimeout: 100,
        connectErrorDelay: 0
      }),
      fm: connFactoryMock
    };
  }

  it("reconnects", function(done) {
    let setup = createTestFactory();
    setup.factory("/foo/bar", new ConnectionContext(), function(err, conn) {
      if (err) {
        throw err;
      }

      // The physical connection hasn't connected yet.
      assert.equal(conn.readyState, WebSocket.CONNECTING);

      conn.onopen = () => {
        // Physical connection has connected.
        assert.equal(conn.readyState, WebSocket.OPEN);

        let origConn = setup.fm.getConn();

        // Killing the physical connection doesn't cause the logical
        // connection to close.
        setup.fm.getConn().close(1005, "", false); // wasClean == false
        assert.equal(conn.readyState, WebSocket.OPEN);

        setTimeout(() => {
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

    let setup = createTestFactory();

    let connectionCount = 0;
    setup.fm.onConnCreate = function(mockConn) {
      connectionCount++;
      mockConn.sendContinue = connectionCount > 1;
      mockConn.close(1005, "", false); // wasClean == false
    };

    setup.factory("/foo/bar", new ConnectionContext(), function(err, conn) {
      if (err) {
        throw err;
      }

      let openWasCalled = false;
      let errorWasCalled = false;
      let closeWasCalled = false;

      conn.onopen = () => { openWasCalled = true; };
      conn.onerror = () => { errorWasCalled = true; };
      conn.onclose = () => {
        closeWasCalled = true;
        finish();
      };

      function finish() {
        assert.equal(conn.readyState, WebSocket.CLOSED);
        assert.equal(connectionCount, 1);
        assert.equal(openWasCalled, false);
        assert.equal(errorWasCalled, true);
        assert.equal(closeWasCalled, true);
        done();
      }
    });
  });


  it("permanent failure behavior", function(done) {
    // Allow connection, then close the underlying conn and
    // force all future conn attempts to fail

    let setup = createTestFactory();

    let connectionCount = 0;
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

      let openWasCalled = false;
      let errorWasCalled = false;
      let closeWasCalled = false;

      conn.onopen = () => { openWasCalled = true; };
      conn.onerror = () => { errorWasCalled = true; };
      conn.onclose = () => { closeWasCalled = true; done(); };

      setTimeout(() => {
        assert.equal(conn.readyState, WebSocket.OPEN);
        assert.equal(setup.fm.getConn().readyState, WebSocket.OPEN);
        assert.equal(openWasCalled, true);
        assert.equal(errorWasCalled, false);
        assert.equal(closeWasCalled, false);

        setup.fm.getConn().close(1005, "", false);
      }, 50);

    });
  });

  it("prepends message numbers", function(done) {
    let setup = createTestFactory();
    setup.factory("/foo/bar", new ConnectionContext(), function(err, conn) {
      if (err) {
        throw err;
      }

      conn.onopen = () => {
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
