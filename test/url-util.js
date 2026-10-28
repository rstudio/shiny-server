/*
 * test/url-util.js
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

var assert = require('assert');
var child_process = require('child_process');
var url = require('url');
var parseRequestUrl = require('../lib/core/url-util').parseRequestUrl;

/** Runs `code` in a fresh Node process and returns its stderr. */
function stderrOf(code) {
  var result = child_process.spawnSync(process.execPath, ['-e', code], {
    cwd: __dirname + '/..',
    encoding: 'utf8'
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stderr;
}

describe('url-util', function() {
  describe('#parseRequestUrl', function() {

    it('gives the same answers as url.parse()', function() {
      // url.parse() is the oracle here; don't let it print the warning this
      // helper exists to avoid.
      var noDeprecation = process.noDeprecation;
      process.noDeprecation = true;
      try {
        [
          '/app/page?x=1', '/', '*', '/a?', '/a#h?x', '/a?x#h',
          // The routers rely on these arriving as sent; new URL() would
          // resolve the dots and read "//etc" as a host.
          '/a/../b', '/a/%2e%2e/b', '/a/./b', '//etc/passwd', '//u@h/p',
          '/a\\..\\b', '/a?b\\c', '/a b', '/a"<>{}|^`b',
          '/app/__sockjs__/n=abc/000/x/websocket', 'http://h/p?q'
        ].forEach(function(target) {
          var expected = url.parse(target);
          var actual = parseRequestUrl(target);
          ['pathname', 'search', 'path', 'query'].forEach(function(field) {
            assert.strictEqual(actual[field], expected[field],
              field + ' of ' + JSON.stringify(target));
          });
        });
      } finally {
        process.noDeprecation = noDeprecation;
      }
    });

    it('does not emit the url.parse() deprecation warning', function() {
      this.timeout(10000);
      // Control: the check below would see the warning if it were emitted.
      assert.ok(/DEP0169/.test(stderrOf('require("url").parse("/x")')),
        'expected url.parse() itself to warn');
      assert.strictEqual(
        stderrOf('require("./lib/core/url-util").parseRequestUrl("/x")'), '');
    });
  });
});
