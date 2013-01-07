/*
 * parser.js
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
var fs = require('fs');
var util = require('util');
var _ = require('underscore');
var lexer = require('./lexer');

var TT = lexer.TT;

function Directive(nameToken, args, parent, children) {
  this.nameToken = nameToken;
  this.args = args;
  this.children = children;
}

(function() {
  this.getName = function() {
    return this.nameToken ? this.nameToken.content : null;
  };
  this.getArgs = function() {
    return _.pluck(this.args, 'content');
  };
  this.getPosition = function() {
    return this.nameToken ? this.nameToken.position : null;
  };
}).call(Directive.prototype);

exports.ConfigParser = ConfigParser;
function ConfigParser(data, pathHint) {
  this.$tokens = new lexer.Lexer(data, pathHint);
}

(function() {

  this.parse = function() {
    try {
      var rootScope = new Directive(null, [], null, []);
      this.$parseChildDirectives(rootScope, true);
      return rootScope;
    } catch(err) {
      if (err.position) {
        err.message += ' (' + err.position.toString() + ')';
      }
      throw err;
    }
  };

  this.$parseChildDirectives = function(parent, atRoot) {
    while (true) {
      var nextDirective = this.$parseOne(parent);
      if (nextDirective === null) {
        // The data ended.
        if (atRoot)
          return;
        else {
          this.$throw(new Error('The scope was never closed'),
            parent.getPosition());
        }
      } else if (nextDirective === false) {
        // The scope closed.
        if (atRoot) {
          this.$throw(new Error('Unexpected } character encountered'));
        }
        return;
      } else {
        parent.children.push(nextDirective);
      }
    }
  };

  this.$parseOne = function(parent) {
    var nameToken;
    var token;

    while (true) {
      nameToken = this.$nextToken();
      // No more data.
      if (nameToken.type === TT.EOD)
        return null;
      // Scope closed.
      if (nameToken.type === TT.CLOSEBRACE)
        return false;
      // Statement terminated (it was empty); get the next one.
      if (nameToken.type === TT.TERM)
        continue;
      if (nameToken.type !== TT.WORD) {
        this.$throw(new Error('Unexpected token encountered: ' +
            nameToken.content));
      }

      // The nameToken is TT.WORD, we're good.
      var directive = new Directive(nameToken, [], parent, []);

      // Now let's look for args (words), '{', or ';'
      while (true) {
        token = this.$nextToken();
        switch (token.type) {
          case TT.WORD:
            directive.args.push(token);
            continue;
          case TT.OPENBRACE:
            this.$parseChildDirectives(directive, false);
            return directive;
          case TT.CLOSEBRACE:
            this.$throw(
                new Error('Unexpected } character (did you leave a semicolon off the previous directive?)'));
          case TT.TERM:
            return directive;
          case TT.EOD:
            this.$throw(
                new Error('Unterminated directive; did you leave off a semicolon?'),
                    nameToken.position);
          default:
            assert(false, 'Programmer error: Forgot to handle ' + token.type);
        }
      }
    }
  };

  this.$nextToken = function() {
    while (true) {
      var t = this.$tokens.nextToken();
      switch (t.type) {
        // Filter out whitespace and comments
        case TT.WS:
        case TT.COMMENT:
          continue;
        default:
          this.$lastKnownPos = t.position;
          return t;
      }
    }
  };

  this.$throw = function(err, position) {
    position = position || this.$lastKnownPos;
    if (position)
      err.position = position;
    throw err;
  };
}).call(ConfigParser.prototype);