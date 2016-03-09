"use strict";

const assert = require("assert");

module.exports = fixupUrl;

function fixupUrl(href, location) {
  let origHref = href;
  // Strip the worker out of the href
  href = href.replace(/\/_w_[a-f0-9]+\//g, "/");
  if (href === origHref) {
    // Must not have been a relative URL, or base href isn't in effect.
    return origHref;
  }

  let m = /^([^#?]*)(\?[^#]*)?(#.*)?$/.exec(href);
  assert(m);
  let base = m[1] || "";
  let search = m[2] || "";
  let hash = m[3] || "";

  if (base !== location.origin + location.pathname) {
    return origHref;
  }

  if (!search) {
    // href doesn't include the query string, which means that if one is
    // present (e.g. ?rscembedded=1) anchor links will be labeled page changes
    // by the browser, triggering a reload (and perhaps nested toolbars).
    search = location.search;
  }

  return base + search + hash;
}
