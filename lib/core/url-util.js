/*
 * url-util.js
 *
 * Copyright (C) 2009-13 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

var url = require('url');

function isAppPagePath(path) {
  return path && (path === "/" || path.match(/\.[rq]md$/i));
}
exports.isAppPagePath = isAppPagePath;

/**
 * Parses a request target (`req.url`, or a SockJS connection's `url`) the way
 * url.parse() does -- with the same parser, so with the same results.
 *
 * url.parse() emits a DEP0169 deprecation warning on first use, but the
 * warning lives only in the url.parse() wrapper; `Url.prototype.parse`
 * underneath is the parser itself and does not warn.
 *
 * Don't swap in `new URL(target, base)`. It resolves "." and ".." segments
 * (percent-encoded ones too) and reads a leading "//" as a host, so the
 * routers would pick a destination from the normalized path while the proxy
 * and SockJS go on forwarding the raw one, and a request could be routed into
 * a location its URL doesn't literally start with. See
 * memory-bank/routerChain.md.
 */
function parseRequestUrl(target) {
  var parsed = new url.Url();
  parsed.parse(target);
  return parsed;
}
exports.parseRequestUrl = parseRequestUrl;
