"use strict";

const assert = require("chai").assert;
const util = require("../lib/util");
const WebSocket = require("../lib/websocket");
const TrivialConnection = require("./common").TrivialConnection;

const PauseConnection = util.PauseConnection;

describe("PauseConnection", () => {
  // This will model the underlying connection that's
  // being paused.
  let tc = new TrivialConnection();
  tc.protocol = "whatever";
  let pc = new PauseConnection(tc);
  let pcLog = [];
  pc.onopen = () => pcLog.push("open");
  pc.onmessage = () => pcLog.push("message");
  pc.onclose = () => pcLog.push("close");
  pc.onerror = () => pcLog.push("error");

  it("copies basic properties", () => {
    assert.equal(pc.url, tc.url);
    assert.equal(pc.protocol, tc.protocol);
  });

  it("pauses", done => {
    tc.readyState = WebSocket.OPEN;
    tc.onopen(util.createEvent("open"));
    tc.onmessage(util.createEvent("message", {
      data: "Hello"
    }));
    assert.equal(pcLog.length, 0);
    assert.equal(pc.readyState, WebSocket.CONNECTING);
    setTimeout(() => {
      assert.equal(pcLog.length, 0);
      assert.equal(pc.readyState, WebSocket.CONNECTING);
      done();
    }, 100);
  });

  it("resumes", done => {
    pc.resume();
    setTimeout(() => {
      assert.equal(pcLog.length, 2);
      assert.equal(pc.readyState, WebSocket.OPEN);
      done();
    }, 100);
  });
});
