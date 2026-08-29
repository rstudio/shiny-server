/*
 * test/integration/static-files.js
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

// Characterization of static file serving through DirectoryRouter, which is
// where `send` is used directly. This is the code most exposed to the
// send 0.19 -> 1.x upgrade that rides along with Express 5.

var assert = require('assert');
var testServer = require('../support/server');
var testConfig = require('../support/config');

describe('static files', function() {

  describe('with directory_index on', function() {
    var server;

    before(function() {
      return testServer.start_p(testConfig.siteDirConfig(), {
        files: {
          'site/plain.txt': 'hello\n',
          'site/script.R': 'cat("hi")\n',
          'site/withindex/index.html': '<h1>the index</h1>',
          'site/withindex/other.txt': 'other\n',
          'site/noindex/a.txt': 'a\n'
        }
      })
      .then(function(s) { server = s; });
    });

    after(function() {
      return server ? server.stop_p() : null;
    });

    it('serves a plain file', function() {
      return server.get_p('/plain.txt').then(function(r) {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body, 'hello\n');
      });
    });

    it('serves .R as text/R', function() {
      // This is the one line changed for send 1.x: directory-router.js does
      // `send.mime.define({'text/R': ['r']})` on send 0.19 and
      // `require('mime-types').types['r'] = 'text/R'` on send 1.x. Both are
      // process-global mutations; this asserts the observable result.
      return server.get_p('/script.R').then(function(r) {
        assert.strictEqual(r.status, 200);
        // Note the uppercase charset: that is what send 0.19's mime table
        // produces. If this flips to "utf-8" it means the mime lookup changed,
        // which is exactly the kind of drift this test exists to catch.
        assert.strictEqual(r.headers.get('content-type'), 'text/R; charset=UTF-8');
        assert.strictEqual(r.body, 'cat("hi")\n');
      });
    });

    it('serves index.html for a directory that has one', function() {
      return server.get_p('/withindex/').then(function(r) {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body, '<h1>the index</h1>');
      });
    });

    it('redirects a directory without a trailing slash', function() {
      return server.get_p('/withindex').then(function(r) {
        assert.strictEqual(r.status, 301);
        assert.strictEqual(r.headers.get('location'), '/withindex/');
      });
    });

    it('preserves the query string in the trailing-slash redirect', function() {
      return server.get_p('/withindex?a=b').then(function(r) {
        assert.strictEqual(r.status, 301);
        assert.strictEqual(r.headers.get('location'), '/withindex/?a=b');
      });
    });

    it('auto-indexes a directory with no index.html', function() {
      return server.get_p('/noindex/').then(function(r) {
        assert.strictEqual(r.status, 200);
        assert.ok(/a\.txt/.test(r.body),
          'expected an index listing containing a.txt, got: ' + r.body.slice(0, 300));
      });
    });

    it('404s a missing file', function() {
      return server.get_p('/no-such-file.txt').then(function(r) {
        assert.strictEqual(r.status, 404);
      });
    });
  });

  describe('with directory_index off', function() {
    var server;

    before(function() {
      return testServer.start_p(
        testConfig.siteDirConfig({directoryIndex: 'off'}), {
          files: {
            'site/noindex/a.txt': 'a\n',
            'site/withindex/index.html': '<h1>the index</h1>'
          }
        })
      .then(function(s) { server = s; });
    });

    after(function() {
      return server ? server.stop_p() : null;
    });

    it('404s a directory with no index.html', function() {
      // $staticServe_p resolves null here, which the router chain treats as
      // "not mine"; the request falls out the bottom of the chain as a 404.
      return server.get_p('/noindex/').then(function(r) {
        assert.strictEqual(r.status, 404);
      });
    });

    it('still serves index.html when there is one', function() {
      return server.get_p('/withindex/').then(function(r) {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body, '<h1>the index</h1>');
      });
    });
  });
});
