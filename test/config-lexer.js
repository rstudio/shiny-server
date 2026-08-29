/*
 * test/config-lexer.js
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

// Ported from manual.test/test-config-lexer.js, which was a standalone script
// nothing ever ran. The config language is hand-written and entirely
// self-contained, which makes it both the cheapest thing to cover and the
// scariest thing to port to TypeScript uncovered.

var assert = require('assert');
var lexer = require('../lib/config/lexer');
var TT = lexer.TT;

// The lexer's character classes are private, so reproduce the numbering from
// lib/config/lexer.js rather than exporting it just for the test.
var c_ = 1;
var C_ALPHA = c_++;
var C_DIGIT = c_++;
var C_OPENBRACE = c_++;
var C_CLOSEBRACE = c_++;
var C_SEMICOLON = c_++;
var C_HASH = c_++;
var C_SQUOTE = c_++;
var C_DQUOTE = c_++;
var C_BACKSLASH = c_++;
var C_EOL = c_++;
var C_WS = c_++;
var C_CONTROL = c_++;
var C_OTHER = c_ + 100;

/**
 * Lexes `data` and asserts the full token stream, as
 * [type, content, line, col] tuples. EOD is implicit.
 */
function assertLex(data, expected) {
  var lex = new lexer.Lexer(data);
  var actual = [];
  var tok;
  while ((tok = lex.nextToken()).type != TT.EOD) {
    actual.push([tok.type, tok.content, tok.position.line, tok.position.col]);
  }
  assert.deepStrictEqual(actual, expected);
}

function lexAll(data) {
  return function() {
    var lex = new lexer.Lexer(data);
    while (lex.nextToken().type != TT.EOD) {}
  };
}

describe('config lexer', function() {

  describe('character classification', function() {
    var lex = new lexer.Lexer('');

    var cases = [
      ['a', C_ALPHA], ['Z', C_ALPHA],
      ['1', C_DIGIT],
      ['{', C_OPENBRACE], ['}', C_CLOSEBRACE],
      [';', C_SEMICOLON],
      ['#', C_HASH],
      ["'", C_SQUOTE], ['"', C_DQUOTE],
      ['\\', C_BACKSLASH],
      [' ', C_WS], ['\t', C_WS], ['\r', C_WS],
      ['\n', C_EOL],
      ['\x01', C_CONTROL],
      ['?', C_OTHER]
    ];

    cases.forEach(function(c) {
      it('classifies ' + JSON.stringify(c[0]), function() {
        assert.strictEqual(lex.$classify(c[0]), c[1]);
      });
    });
  });

  describe('tokenizing', function() {
    it('lexes a bare word', function() {
      assertLex('foo', [[TT.WORD, 'foo', 1, 1]]);
    });

    it('treats punctuation other than the specials as part of a word', function() {
      assertLex('foo  \t    b12?ar', [
        [TT.WORD, 'foo', 1, 1],
        [TT.WS, '  \t    ', 1, 4],
        [TT.WORD, 'b12?ar', 1, 11]
      ]);
    });

    it('unescapes a double-quoted string', function() {
      assertLex('"hel\\"\\\'\'\\l\\\\o"', [
        [TT.WORD, 'hel"\'\'l\\o', 1, 1]
      ]);
    });

    it('lexes a comment after whitespace', function() {
      assertLex('foo # "hello"', [
        [TT.WORD, 'foo', 1, 1],
        [TT.WS, ' ', 1, 4],
        [TT.COMMENT, ' "hello"', 1, 5]
      ]);
    });

    it('lexes a comment with no preceding whitespace', function() {
      assertLex('foo# "hello"', [
        [TT.WORD, 'foo', 1, 1],
        [TT.COMMENT, ' "hello"', 1, 4]
      ]);
    });

    it('does not treat # inside a quoted string as a comment', function() {
      assertLex('\'foo # "hello"\'', [
        [TT.WORD, 'foo # "hello"', 1, 1]
      ]);
    });

    it('lexes an empty comment', function() {
      assertLex('#\nhi', [
        [TT.COMMENT, '', 1, 1],
        [TT.WS, '\n', 1, 2],
        [TT.WORD, 'hi', 2, 1]
      ]);
    });

    it('normalizes CRLF to LF', function() {
      assertLex('foo\r\nbar', [
        [TT.WORD, 'foo', 1, 1],
        [TT.WS, '\n', 1, 4],
        [TT.WORD, 'bar', 2, 1]
      ]);
    });

    it('allows a newline inside a quoted string and keeps line numbers right', function() {
      assertLex('foo"\nbar"baz', [
        [TT.WORD, 'foo', 1, 1],
        [TT.WORD, '\nbar', 1, 4],
        [TT.WORD, 'baz', 2, 5]
      ]);
    });

    it('lexes braces and semicolons as their own tokens', function() {
      assertLex('a {b;}', [
        [TT.WORD, 'a', 1, 1],
        [TT.WS, ' ', 1, 2],
        [TT.OPENBRACE, '{', 1, 3],
        [TT.WORD, 'b', 1, 4],
        [TT.TERM, ';', 1, 5],
        [TT.CLOSEBRACE, '}', 1, 6]
      ]);
    });

    it('lexes empty input as nothing but EOD', function() {
      assertLex('', []);
    });
  });

  describe('errors', function() {
    it('rejects an unterminated quote', function() {
      assert.throws(lexAll('"'));
    });

    it('rejects a trailing backslash inside a quote', function() {
      assert.throws(lexAll('"\\'));
    });

    it('rejects a quote whose terminator was escaped', function() {
      assert.throws(lexAll('"\\"'));
    });

    it('rejects control characters', function() {
      assert.throws(lexAll('\x01'));
    });

    it('reports the position of the offending character', function() {
      try {
        lexAll('foo\nbar \x01')();
        assert.fail('should have thrown');
      } catch (err) {
        assert.ok(err.position, 'error should carry a position');
        assert.strictEqual(err.position.line, 2);
        assert.strictEqual(err.position.col, 5);
      }
    });

    it('includes the path hint in the position when given one', function() {
      try {
        var lex = new lexer.Lexer('\x01', '/etc/shiny-server/shiny-server.conf');
        lex.nextToken();
        assert.fail('should have thrown');
      } catch (err) {
        assert.ok(/shiny-server\.conf:1:1/.test(err.position.toString()),
          'unexpected position: ' + err.position.toString());
      }
    });
  });
});
