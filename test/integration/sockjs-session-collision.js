/*
 * test/integration/sockjs-session-collision.js
 *
 * Copyright (C) 2026 by Posit Software, PBC
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

// Regression test for the SockJS URL prefix in lib/proxy/sockjs.js.
//
// SockJS builds its route regexes by appending its own numbered capture
// groups -- "([^/.]+)" for the server number, then "([^/.]+)" for the
// session id -- to the configured `prefix`, and reads the matches back
// positionally. When the prefix's optional robust-session segment was
// written as a CAPTURING group, "(/[no]=\\w+)?", every SockJS group shifted
// by one and the server-number segment was parsed as the session id.
//
// The server number is meant for sticky load balancing; sockjs-client draws
// it at random for each new SockJS object, so in production two concurrent
// HTTP-fallback sessions collided only when their numbers happened to match.
// These tests pin both clients to the same server-number segment ("000") to
// force the collision deterministically: with the capturing group, the two
// clients resolve to one SockJS session and the second client never receives
// an open frame (its poll either hangs or is answered with SockJS close
// 2010, "Another connection still open"); with the group non-capturing,
// each client gets its own session and its own open frame.

var assert = require('assert');
var testServer = require('../support/server');
var testConfig = require('../support/config');

describe('SockJS session-id parsing', function() {
  var server;

  beforeEach(function() {
    return testServer.start_p(testConfig.siteDirConfig({}), {
      files: {
        'site/myapp/server.R': '# not actually run\n',
        'site/myapp/ui.R': '# not actually run\n'
      }
    })
    .then(function(s) { server = s; });
  });

  afterEach(function() {
    var s = server;
    server = null;
    return s ? s.stop_p() : null;
  });

  it('gives two xhr clients with the same server segment their own sessions',
    async function() {
      for (var id of ['first-client', 'second-client']) {
        // The open frame must arrive promptly. With the parsing bug the
        // second client's poll attaches to the first client's (still
        // lingering) session and no open frame is ever sent for it, so the
        // request only ends when this timeout destroys it.
        var response = await server.get_p(
          '/myapp/__sockjs__/000/' + id + '/xhr', {
            method: 'POST',
            timeout: 2000
          });
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.body, 'o\n');
      }
    });

  it('keeps the robust-session segment from shifting the parse', async function() {
    // A robust session ("/n=<token>") between the prefix and the server
    // number exercises the optional group itself: it must match without
    // consuming a capture slot.
    var response = await server.get_p(
      '/myapp/__sockjs__/n=abc123/000/some-session/xhr', {
        method: 'POST',
        timeout: 2000
      });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body, 'o\n');
  });
});
