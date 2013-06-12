var assert = require('assert');
var util = require('util');
var config_lexer = require('../lib/config/lexer');
var TT = config_lexer.TT;

var lex = new config_lexer.Lexer("");

var c_ = 1;
var C_ALPHA = c_++;
var C_DIGIT = c_++;
var C_OPENBRACE = c_++;    // {
var C_CLOSEBRACE = c_++;   // }
var C_SEMICOLON = c_++;    // ;
var C_HASH = c_++;         // #
var C_SQUOTE = c_++;       // '
var C_DQUOTE = c_++;       // "
var C_BACKSLASH = c_++;
var C_EOL = c_++;
var C_WS = c_++;           // whitespace
var C_CONTROL = c_++;
var C_OTHER = c_ + 100;
var C_EOD = c_ + 101;

assert(lex.$classify('a') == C_ALPHA);
assert(lex.$classify('Z') == C_ALPHA);
assert(lex.$classify('1') == C_DIGIT);
assert(lex.$classify('{') == C_OPENBRACE);
assert(lex.$classify('}') == C_CLOSEBRACE);
assert(lex.$classify(';') == C_SEMICOLON);
assert(lex.$classify('#') == C_HASH);
assert(lex.$classify("'") == C_SQUOTE);
assert(lex.$classify('"') == C_DQUOTE);
assert(lex.$classify('\\') == C_BACKSLASH);
assert(lex.$classify(' ') == C_WS);
assert(lex.$classify('\t') == C_WS);
assert(lex.$classify('\r') == C_WS);
assert(lex.$classify('\n') == C_EOL);
assert(lex.$classify('\x01') == C_CONTROL);
assert(lex.$classify('?') == C_OTHER);

assertLex('foo', [
  [TT.WORD, 'foo', 1, 1],
]);

assertLex('foo  \t    b12?ar', [
  [TT.WORD, 'foo', 1, 1],
  [TT.WS, '  \t    ', 1, 4],
  [TT.WORD, 'b12?ar', 1, 11],
]);

assertLex('"hel\\"\\\'\'\\l\\\\o"', [
  [TT.WORD, 'hel"\'\'l\\o', 1, 1],
]);

assertLex('foo # "hello"', [
  [TT.WORD, 'foo', 1, 1],
  [TT.WS, ' ', 1, 4],
  [TT.COMMENT, ' "hello"', 1, 5],
]);

assertLex('foo# "hello"', [
  [TT.WORD, 'foo', 1, 1],
  [TT.COMMENT, ' "hello"', 1, 4],
]);

assertLex('\'foo # "hello"\'', [
  [TT.WORD, 'foo # "hello"', 1, 1],
]);

// \r\n is normalized to \n
assertLex('foo\r\nbar', [
  [TT.WORD, 'foo', 1, 1],
  [TT.WS, '\n', 1, 4],
  [TT.WORD, 'bar', 2, 1],
]);

assertLex('foo"\nbar"baz', [
  [TT.WORD, 'foo', 1, 1],
  [TT.WORD, '\nbar', 1, 4],
  [TT.WORD, 'baz', 2, 5],
]);

assertLex('#\nhi', [
  [TT.COMMENT, '', 1, 1],
  [TT.WS, '\n', 1, 2],
  [TT.WORD, 'hi', 2, 1],
]);

assert.throws(lexAll('"'));
assert.throws(lexAll('"\\'));
assert.throws(lexAll('"\\"'));
assert.throws(lexAll('\x01'));

function assertLex(data, tokens) {
  var tmpLex = new config_lexer.Lexer(data);
  var tok;
  while ((tok = tmpLex.nextToken()).type != TT.EOD) {
    var testTok = tokens.shift();
    if (!testTok)
      assert(false, 'Too many tokens were returned');
    assert.equal(tok.type, testTok[0]);
    assert.equal(tok.content, testTok[1]);
    assert.equal(tok.position.line, testTok[2]);
    assert.equal(tok.position.col, testTok[3]);
  }
  if (tokens.length > 0)
    assert(false, 'Not all tokens were matched');
}

function lexAll(data) {
  return function() {
    var tmpLex = new config_lexer.Lexer(data);
    while (tmpLex.nextToken().type != TT.EOD)
    {}
  };
}