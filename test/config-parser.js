/*
 * test/config-parser.js
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

// The parser turns the lexer's token stream into a tree of directives, and
// config.js then wraps that in ConfigNode, whose lookup methods (getOne,
// getValue, search) implement the inheritance rules the whole config system
// rests on. manual.test/test-config-parser.js printed a tree for a human to
// eyeball; these are actual assertions.

var assert = require('assert');
var config = require('../lib/config/config');

/**
 * Reduces a ConfigNode tree to plain data, for easy structural assertions.
 */
function simplify(node) {
  return {
    name: node.name,
    args: node.args,
    children: node.children.map(simplify)
  };
}

describe('config parser', function() {

  describe('structure', function() {
    it('parses a simple directive with no args', function() {
      var root = config.parse('foo;');
      assert.deepStrictEqual(simplify(root), {
        name: null, args: [], children: [
          {name: 'foo', args: [], children: []}
        ]
      });
    });

    it('parses arguments', function() {
      var root = config.parse('run_as shiny admin;');
      assert.deepStrictEqual(root.children[0].name, 'run_as');
      assert.deepStrictEqual(root.children[0].args, ['shiny', 'admin']);
    });

    it('parses a block with children', function() {
      var root = config.parse('server {\n  listen 3838;\n}');
      assert.deepStrictEqual(simplify(root), {
        name: null, args: [], children: [
          {name: 'server', args: [], children: [
            {name: 'listen', args: ['3838'], children: []}
          ]}
        ]
      });
    });

    it('parses a block with both args and children', function() {
      var root = config.parse('location /foo { app_dir /bar; }');
      var loc = root.children[0];
      assert.strictEqual(loc.name, 'location');
      assert.deepStrictEqual(loc.args, ['/foo']);
      assert.strictEqual(loc.children.length, 1);
    });

    it('nests arbitrarily deep', function() {
      var root = config.parse('a { b { c { d 1; } } }');
      var node = root;
      ['a', 'b', 'c', 'd'].forEach(function(name) {
        node = node.children[0];
        assert.strictEqual(node.name, name);
      });
      assert.deepStrictEqual(node.args, ['1']);
    });

    it('records depth, starting at 0 for the root', function() {
      var root = config.parse('a { b; }');
      assert.strictEqual(root.depth, 0);
      assert.strictEqual(root.children[0].depth, 1);
      assert.strictEqual(root.children[0].children[0].depth, 2);
    });

    it('links each node to its parent', function() {
      var root = config.parse('a { b; }');
      var a = root.children[0];
      assert.strictEqual(a.parent, root);
      assert.strictEqual(a.children[0].parent, a);
      assert.strictEqual(root.parent, null);
    });

    it('ignores comments and whitespace', function() {
      var root = config.parse('# a comment\n\n  foo bar;  # trailing\n');
      assert.strictEqual(root.children.length, 1);
      assert.deepStrictEqual(root.children[0].args, ['bar']);
    });

    it('skips empty statements', function() {
      var root = config.parse(';;; foo; ;;');
      assert.strictEqual(root.children.length, 1);
      assert.strictEqual(root.children[0].name, 'foo');
    });

    it('parses an empty document into a childless root', function() {
      var root = config.parse('');
      assert.strictEqual(root.name, null);
      assert.deepStrictEqual(root.children, []);
    });

    it('keeps quoted arguments intact', function() {
      var root = config.parse('desc "hello world; # not a comment";');
      assert.deepStrictEqual(root.children[0].args,
        ['hello world; # not a comment']);
    });

    it('records the position of each directive', function() {
      var root = config.parse('a;\n\n  b;');
      assert.strictEqual(root.children[0].position.line, 1);
      assert.strictEqual(root.children[0].position.col, 1);
      assert.strictEqual(root.children[1].position.line, 3);
      assert.strictEqual(root.children[1].position.col, 3);
    });
  });

  describe('syntax errors', function() {
    function assertParseError(text, pattern) {
      assert.throws(
        function() { config.parse(text, '/tmp/test.conf'); },
        function(err) {
          assert.ok(pattern.test(err.message),
            'expected /' + pattern.source + '/, got: ' + err.message);
          return true;
        }
      );
    }

    it('rejects a directive with no terminator', function() {
      assertParseError('foo bar', /Unterminated directive/);
    });

    it('rejects an unclosed scope', function() {
      assertParseError('server { listen 80;', /scope was never closed/i);
    });

    it('rejects a stray closing brace', function() {
      assertParseError('}', /Unexpected \} character/);
    });

    it('suggests the missing semicolon when a scope closes mid-directive', function() {
      assertParseError('server { listen 80 }', /did you leave a semicolon off/);
    });

    it('annotates the error message with file, line and column', function() {
      assertParseError('a;\nserver { listen 80;', /\/tmp\/test\.conf:2:1/);
    });
  });

  describe('ConfigNode lookup', function() {
    var root;

    beforeEach(function() {
      root = config.parse([
        'run_as shiny;',
        'server {',
        '  listen 3838;',
        '  location /a {',
        '    app_dir /srv/a;',
        '    location /b {',
        '      app_dir /srv/b;',
        '    }',
        '  }',
        '}'
      ].join('\n'));
    });

    function locationB() {
      return root.children[1].children[1].children[1];
    }

    it('getOne finds a direct child', function() {
      assert.strictEqual(root.getOne('run_as', false).name, 'run_as');
    });

    it('getOne inherits from ancestors by default', function() {
      // This is the mechanism behind "run_as declared once at the top applies
      // everywhere below".
      assert.strictEqual(locationB().getOne('run_as').name, 'run_as');
    });

    it('getOne does not inherit when told not to', function() {
      assert.strictEqual(locationB().getOne('run_as', false), null);
    });

    it('getOne prefers the nearest definition', function() {
      var b = locationB();
      assert.deepStrictEqual(b.getOne('app_dir').args, ['/srv/b']);
    });

    it('getValue returns the first argument', function() {
      assert.strictEqual(root.getValue('run_as'), 'shiny');
    });

    it('getValue falls back to the default when there is no match', function() {
      assert.strictEqual(root.getValue('nonexistent', 'fallback'), 'fallback');
    });

    it('getValue falls back to the default when the directive has no args', function() {
      var node = config.parse('empty;');
      assert.strictEqual(node.getValue('empty', 'fallback'), 'fallback');
    });

    it('getAll returns only direct children', function() {
      var multi = config.parse('a 1; a 2; b { a 3; }');
      assert.deepStrictEqual(
        multi.getAll('a').map(function(n) { return n.args[0]; }),
        ['1', '2']);
    });

    it('search finds descendants depth-first, preorder', function() {
      var names = root.search(/^location$/, true).map(function(n) {
        return n.args[0];
      });
      assert.deepStrictEqual(names, ['/a', '/b']);
    });

    it('search in postOrder puts nested locations first', function() {
      // config-router relies on this so a nested location wins over its parent.
      var names = root.search('location', false, true).map(function(n) {
        return n.args[0];
      });
      assert.deepStrictEqual(names, ['/b', '/a']);
    });

    it('search honors includeSelf', function() {
      var server = root.children[1];
      assert.strictEqual(server.search('server', true).length, 1);
      assert.strictEqual(server.search('server', false).length, 0);
    });

    it('accepts a criteria of true or false', function() {
      assert.ok(root.search(true, true).length > 5);
      assert.deepStrictEqual(root.search(false, true), []);
    });

    it('accepts a function as criteria', function() {
      var found = root.search(function(node) {
        return node.args.length === 1 && node.args[0] === '/srv/b';
      }, true);
      assert.strictEqual(found.length, 1);
      assert.strictEqual(found[0].name, 'app_dir');
    });

    it('rejects an unusable criteria type', function() {
      assert.throws(function() { root.search(42, true); },
        /Unexpected criteria type/);
    });

    it('getValues returns an empty object rather than null when unmatched', function() {
      assert.deepStrictEqual(root.getValues('nonexistent'), {});
    });
  });
});
