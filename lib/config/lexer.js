/*
 * lexer.js
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
var assert = require('assert');
var util = require('util');
var _ = require('underscore');

/**
 * Token type constants
 */
var TT = exports.TT = {
  WORD: 'TT_WORD',
  OPENBRACE: 'TT_OPENBRACE',
  CLOSEBRACE: 'TT_CLOSEBRACE',
  TERM: 'TT_TERM',
  WS: 'TT_WS',
  COMMENT: 'TT_COMMENT',
  EOD: 'TT_EOD'
};

/**
 * Character classification constants
 */
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
delete c_;

function Position(line, col, offset, file) {
  this.line = line;
  this.col = col;
  this.offset = offset;
  this.file = file;
}
(function() {
  this.toString = function() {
    if (this.file)
      return util.format("%s:%d:%d", this.file, this.line, this.col);
    else
      return util.format("at line %d, column %d", this.line, this.col);
  }
}).call(Position.prototype);

function Token(type, content, position) {
  this.type = type;
  this.content = content;
  this.position = position;
}

(function() {
}).call(Token.prototype);

exports.Lexer = Lexer;
/**
 * @param {String} data The config data.
 * @param {String} [pathHint] The path to the config data's file (for error
 *   logging/debugging purposes).
 */
function Lexer(data, pathHint) {
  this.$data = data.replace(/\r/, ''); // Strip carriage return
  this.$pathHint = pathHint;

  // Pointer into this.$data that indicates where the next character is.
  // This value must never be changed except by $nextChar(), which knows
  // how to keep $line and $col in sync.
  this.$pos = 0;
  // 1-based row and column
  this.$line = 1;
  this.$col = 1;
}

(function() {
  /**
   * Return the next token, or null if done.
   *
   * Will throw if a control character or unterminated quoted string is
   * encountered. The exception will have a `position` property that is an
   * object with line and col properties (1-based).
   */
  this.nextToken = function() {
    // This is the position of the next character, and thus the starting
    // position of the new token
    var tokenStart = new Position(
        this.$line, this.$col, this.$pos, this.$pathHint);

    // String value indicating the logical token value--may differ from the
    // source characters (for example quoting/escaping are performed)
    var content;
    // One of the TT.XXX constants
    var type = 0;

    // General approach: We can tell by peeking at the first character what
    // kind of token we're going to match. Then call $matchXXX methods that
    // know how to consume those tokens.
    try {
      var c = this.$peekChar();
      switch (this.$classify(c)) {
        case C_ALPHA:
        case C_DIGIT:
        case C_OTHER:
        case C_BACKSLASH:
          type = TT.WORD;
          content = this.$matchWord();
          break;
        case C_SEMICOLON:
          type = TT.TERM;
          content = this.$nextChar();
          break;
        case C_OPENBRACE:
          type = TT.OPENBRACE;
          content = this.$nextChar();
          break;
        case C_CLOSEBRACE:
          type = TT.CLOSEBRACE;
          content = this.$nextChar();
          break;
        case C_EOL:
          type = TT.WS;
          content = this.$nextChar();
          break;
        case C_WS:
          type = TT.WS;
          content = this.$matchWhitespace();
          break;
        case C_HASH:
          type = TT.COMMENT;
          content = this.$matchComment();
          break;
        case C_SQUOTE:
          type = TT.WORD;
          content = this.$matchQuoted();
          break;
        case C_DQUOTE:
          type = TT.WORD;
          content = this.$matchQuoted();
          break;
        case C_CONTROL:
          throw new Error('Invalid character detected');
        case C_EOD:
          type = TT.EOD;
          content = '';
          break;
      }

      assert(type);

      return new Token(type, content, tokenStart);

    } catch (ex) {
      ex.position = tokenStart;
      throw ex;
    }
  };

  this.$matchWord = function() {
    var result = "";
    while (true) {
      switch (this.$classify(this.$peekChar())) {
        case C_ALPHA:
        case C_DIGIT:
        case C_OTHER:
        case C_BACKSLASH:
          result += this.$nextChar();
          break;
        default:  // Note: Includes C_EOD
          return result;
      }
    }
  };

  this.$matchWhitespace = function() {
    // Eat one or more whitespace characters
    return this.$consumeRegex(/[ \t\r]+/g);
  };

  this.$matchComment = function() {
    // Discard the leading #
    var hash = this.$nextChar();
    assert.equal(hash, '#');
    // Eat # to end of line
    return this.$consumeRegex(/[^\n]*/g);
  };

  this.$matchQuoted = function() {
    var value = '';
    var nextChar;
    var quot = this.$nextChar();
    assert(quot === '"' || quot === "'", '$matchQuoted called incorrectly');
    while (true) {
      // Eat all characters that aren't special with respect to quoted strings;
      // that includes everything but single/double quotes and backslash
      value += this.$consumeRegex(/[^'"\\]*/g);
      switch (this.$peekChar()) {
        case '"':
        case "'":
          if (this.$peekChar() !== quot) {
            // False alarm, this is not the same kind of quote character that
            // was used to start this quoted string
            value += this.$nextChar();
          } else {
            // All done--discard the close quote and return!
            this.$nextChar();
            return value;
          }
          break;
        case '\\':
          this.$nextChar(); // consume backslash
          if (this.$eod())
            throw new Error('Closing ' + quot + ' character was not found');
          else
            value += this.$nextChar();
          break;
        case null:
          throw new Error('Closing ' + quot + ' character was not found');
      }
    }
  };

  this.$consumeRegex = function(re) {
    re.lastIndex = this.$pos;
    var m = re.exec(this.$data);
    assert(m);
    assert.equal(m.index, this.$pos);
    this.$advanceBy(m[0].length);
    return m[0];
  }

  /**
   * Get the next char and advance the cursor.
   */
  this.$nextChar = function() {
    if (this.$eod())
      return null;
    var c = this.$data.charAt(this.$pos++);
    if (c === '\n') {
      this.$line++;
      this.$col = 1;
    } else {
      this.$col++;
    }
    return c;
  };

  /**
   * Skip over n characters.
   *
   * This uses a slow implementation of calling $nextChar() n times rather than
   * just `this.$pos += n` because $line and $col need to be kept in sync with
   * $pos. There are faster ways than this of course, but would take more code
   * than seems worth it.
   */
  this.$advanceBy = function(n) {
    assert(n >= 0);

    var c;
    for (var i = 0; i < n; i++) {
      c = this.$nextChar();
      assert.notEqual(c, null);
    }
  };

  /**
   * Get the next character but don't advance the cursor.
   */
  this.$peekChar = function() {
    if (this.$eod())
      return null;
    return this.$data.charAt(this.$pos);
  };

  // Return true if we're done
  this.$eod = function() {
    return this.$pos < 0 || this.$pos >= this.$data.length;
  };

  var re = /^(?:([a-zA-Z])|([0-9])|(\{)|(\})|(;)|(#)|(')|(")|(\\)|(\n)|([ \t\r])|([\x00-\x08\x0B-\x0C\x0E-\x1F]))$/
  var classMap = [C_ALPHA, C_DIGIT, C_OPENBRACE, C_CLOSEBRACE, C_SEMICOLON, C_HASH, C_SQUOTE, C_DQUOTE, C_BACKSLASH, C_EOL, C_WS, C_CONTROL];
  /**
   * Classify the character. Let's try not to call it on every character
   * in the stream.
   */
  this.$classify = function(char) {
    if (char === null)
      return C_EOD;
    var m = re.exec(char);
    if (!m)
      return C_OTHER;
    var capture = _.indexOf(_.map(_.rest(m), function(x) {return !!x}), true);
    assert(capture >= 0 && capture < classMap.length, "Unexpected capture value " + capture);
    return classMap[capture];
  };

}).call(Lexer.prototype);

