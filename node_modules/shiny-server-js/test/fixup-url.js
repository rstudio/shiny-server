"use strict";

const assert = require("chai").assert;

const fixupUrl = require("../lib/fixup-url");

describe("URL fixup", _ => {
  let loc = { origin: "http://localhost", pathname: "/foo/", search: "", hash: "" };

  it("simple hash navigation", function() {
    assert.equal(fixupUrl("http://localhost/foo/_w_123/#link", loc), "http://localhost/foo/#link");
  });

  let loc2 = { origin: "http://localhost", pathname: "/foo/", search: "?embed=1", hash: "" };

  it("preserves context querystring", function() {
    assert.equal(fixupUrl("http://localhost/foo/_w_123/#link", loc2), "http://localhost/foo/?embed=1#link");
  });

  it("preserves context querystring unnecessarily (arguably a bug)", function() {
    // This means that if the URL has a non-empty querystring, and you insert
    // a link with href="", the current URL's querystring is preserved instead
    // of clearing it!
    assert.equal(fixupUrl("http://localhost/foo/_w_123/", loc2), "http://localhost/foo/?embed=1");
  });

  it("preserves href querystring", function() {
    assert.equal(fixupUrl("http://localhost/foo/_w_123/?foo=bar#link", loc2), "http://localhost/foo/?foo=bar#link");
    assert.equal(fixupUrl("http://localhost/foo/_w_123/?foo=bar", loc2), "http://localhost/foo/?foo=bar");
  });

  it("passes through URLs with different paths", function() {
    assert.equal(fixupUrl("http://localhost/foo/bar/_w_123/#link", loc), "http://localhost/foo/bar/_w_123/#link");
    assert.equal(fixupUrl("http://localhost/_w_123/#link", loc), "http://localhost/_w_123/#link");
  });
  it("passes through non-local URLs", function() {
    assert.equal(fixupUrl("http://rstudio.org/foo/_w_123/#link", loc), "http://rstudio.org/foo/_w_123/#link");
  });

});
