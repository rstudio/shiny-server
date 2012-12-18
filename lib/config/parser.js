var fs = require('fs');
var util = require('util');
var _ = require('underscore');
var lexer = require('./lexer');

var TT = lexer.TT;

function Rule(directive, args, parent, children, position) {
  this.directive = directive;
  this.args = args;
  this.children = children;
  this.position = position;
}

(function() {
  this.getDirective = function() {
    return this.directive ? this.directive.content : null;
  };
  this.getArgs = function() {
    return _.pluck(this.args, 'content');
  };
}).call(Rule.prototype);

exports.ConfigParser = ConfigParser;
function ConfigParser(data) {
  this.$tokens = new lexer.Lexer(data);
}

(function() {

  this.parse = function() {
    try {
      var rootScope = new Rule(null, [], null, [], {});
      this.$parseChildRules(rootScope, true);
      return rootScope;
    } catch(err) {
      if (err.position) {
        err.message += ' (at line ' + err.position.line + ', col ' + err.position.col + ')';
      }
      throw err;
    }
  };

  this.$parseChildRules = function(parent, atRoot) {
    while (true) {
      var nextRule = this.$parseOne(parent);
      if (nextRule === null) {
        // The data ended.
        if (atRoot)
          return;
        else {
          throw new Error('The scope at line ' + parent.position.line +
              ' and column ' + parent.position.col + ' was never closed');
        }
      } else if (nextRule === false) {
        // The scope closed.
        if (atRoot) {
          this.$throw(new Error('Unexpected } character encountered'));
        }
        return;
      } else {
        parent.children.push(nextRule);
      }
    }
  };

  this.$parseOne = function(parent) {
    var directive;
    var token;

    while (true) {
      directive = this.$nextToken();
      // No more data.
      if (directive.type === TT.EOD)
        return null;
      // Scope closed.
      if (directive.type === TT.CLOSEBRACE)
        return false;
      // Statement terminated (it was empty); get the next one.
      if (directive.type === TT.TERM)
        continue;
      if (directive.type !== TT.WORD) {
        this.$throw(new Error('Unexpected token encountered: ' +
            directive.content));
      }

      // The directive is TT.WORD, we're good.
      var rule = new Rule(directive, [], parent, []);

      // Now let's look for args (words), '{', or ';'
      while (true) {
        token = this.$nextToken();
        switch (token.type) {
          case TT.WORD:
            rule.args.push(token);
            continue;
          case TT.OPENBRACE:
            this.$parseChildRules(rule, false);
            return rule;
          case TT.CLOSEBRACE:
            this.$throw(
                new Error('Unexpected } character (did you leave a semicolon off the previous rule?)'));
          case TT.TERM:
            return rule;
          case TT.EOD:
            this.$throw(
                new Error('Unterminated directive; did you leave off a semicolon?'),
                    directive.position);
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