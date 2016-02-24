"use strict";

const assert = require("chai").assert;
const pathParams = require("../common/path-params");

describe("Path parameters", () => {
  it("can be reordered", () => {
    assert.equal(
      pathParams.reorderPathParams("/__sockjs__/foo=bar/baz=/", ["baz", "foo"]),
      "/__sockjs__/baz=/foo=bar/"
    );
    assert.equal(
      pathParams.reorderPathParams("/__sockjs__/foo=bar/baz=", ["baz", "foo"]),
      "/__sockjs__/baz=/foo=bar"
    );
    assert.equal(
      pathParams.reorderPathParams("/__sockjs__/foo=bar/baz=/?a=b&c=d/e=f", ["baz", "foo"]),
      "/__sockjs__/baz=/foo=bar/?a=b&c=d/e=f"
    );
    assert.equal(
      pathParams.reorderPathParams("/__sockjs__/foo=bar/baz=?a=b&c=d/e=f", ["baz", "foo"]),
      "/__sockjs__/baz=/foo=bar?a=b&c=d/e=f"
    );
    // Trailing path parts are ignored (SockJS does this to our URLs)
    assert.equal(
      pathParams.reorderPathParams("/__sockjs__/foo=bar/baz=/a/b/c", ["baz", "foo"]),
      "/__sockjs__/baz=/foo=bar/a/b/c"
    );
    assert.equal(pathParams.reorderPathParams("/a=1/b=2", ["a", "b"]), "/a=1/b=2");
    assert.equal(pathParams.reorderPathParams("", ["a", "b"]), "");
    assert.equal(pathParams.reorderPathParams("/", ["a", "b"]), "/");
    assert.equal(pathParams.reorderPathParams("//", ["a", "b"]), "//");

    assert.equal(
      pathParams.reorderPathParams("/__sockjs__/foo=bar/baz=?a=b&c=d/e=f", ["q", "r"]),
      "/__sockjs__/foo=bar/baz=?a=b&c=d/e=f"
    );
  });
});
