/*
 * test/config-schema.js
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

// The schema layer is what turns a parsed config tree into typed `values` and
// what produces every "you can't put that there" error an administrator ever
// sees. The schema itself is written in the same config language
// (config/shiny-server-rules.config), so this covers both halves: applying a
// schema to a config, and the schema language's own validation.

var assert = require('assert');
var config = require('../lib/config/config');
var schema = require('../lib/config/schema');
var paths = require('../lib/core/paths');

/**
 * Applies `schemaText` to `configText` and returns the validated root.
 */
function apply(configText, schemaText) {
  return schema.applySchema(
    config.parse(configText, '/tmp/test.conf'),
    config.parse(schemaText, '/tmp/schema.conf'));
}

function assertRejects(configText, schemaText, pattern) {
  assert.throws(
    function() { apply(configText, schemaText); },
    function(err) {
      assert.ok(pattern.test(err.message),
        'expected /' + pattern.source + '/, got: ' + err.message);
      return true;
    }
  );
}

describe('config schema', function() {

  describe('argument typing', function() {
    var SCHEMA = [
      'thing {',
      '  param Integer count "how many";',
      '  param Boolean flag "whether";',
      '  param Float ratio "how much";',
      '  param String label "what";',
      '  at $;',
      '}'
    ].join('\n');

    it('converts each argument to its declared type', function() {
      var values = apply('thing 42 on 1.5 hello;', SCHEMA).children[0].values;
      // `values` comes from map.create(), so it has a null prototype -- a
      // deliberate choice so that a directive named e.g. "constructor" can't
      // collide with Object.prototype. Spread it before comparing.
      assert.strictEqual(Object.getPrototypeOf(values), null);
      assert.deepStrictEqual(Object.assign({}, values), {
        count: 42, flag: true, ratio: 1.5, label: 'hello'
      });
    });

    ['true', 'yes', 'on', 'TRUE', 'On'].forEach(function(v) {
      it('reads Boolean "' + v + '" as true', function() {
        assert.strictEqual(
          apply('thing 1 ' + v + ' 1.0 x;', SCHEMA).children[0].values.flag,
          true);
      });
    });

    ['false', 'no', 'off', 'OFF'].forEach(function(v) {
      it('reads Boolean "' + v + '" as false', function() {
        assert.strictEqual(
          apply('thing 1 ' + v + ' 1.0 x;', SCHEMA).children[0].values.flag,
          false);
      });
    });

    it('rejects a non-Boolean where a Boolean is required', function() {
      assertRejects('thing 1 maybe 1.0 x;', SCHEMA, /not a valid Boolean/);
    });

    it('accepts a negative Integer', function() {
      assert.strictEqual(
        apply('thing -5 on 1.0 x;', SCHEMA).children[0].values.count, -5);
    });

    it('accepts a hex Integer', function() {
      assert.strictEqual(
        apply('thing 0x10 on 1.0 x;', SCHEMA).children[0].values.count, 16);
    });

    it('accepts zero, which several directives treat as "unlimited"', function() {
      assert.strictEqual(
        apply('thing 0 on 1.0 x;', SCHEMA).children[0].values.count, 0);
    });

    it('rejects a non-Integer', function() {
      assertRejects('thing 1.5 on 1.0 x;', SCHEMA, /not a valid Integer/);
    });

    it('rejects a non-Float', function() {
      assertRejects('thing 1 on . x;', SCHEMA, /not a valid Float/);
    });
  });

  describe('arity', function() {
    var SCHEMA = [
      'thing {',
      '  param String required "r";',
      '  param String [optional] "o";',
      '  at $;',
      '}'
    ].join('\n');

    it('accepts just the required argument', function() {
      var values = apply('thing a;', SCHEMA).children[0].values;
      assert.strictEqual(values.required, 'a');
      assert.strictEqual(values.optional, undefined);
    });

    it('accepts the optional argument too', function() {
      var values = apply('thing a b;', SCHEMA).children[0].values;
      assert.deepStrictEqual([values.required, values.optional], ['a', 'b']);
    });

    it('rejects too few arguments', function() {
      assertRejects('thing;', SCHEMA, /too few arguments; expected 1 to 2, found 0/);
    });

    it('rejects too many arguments', function() {
      assertRejects('thing a b c;', SCHEMA, /too many arguments; expected 1 to 2, found 3/);
    });

    it('applies a declared default to a missing optional argument', function() {
      var s = 'thing { param String [mode] "m" fallback; at $; }';
      assert.strictEqual(apply('thing;', s).children[0].values.mode, 'fallback');
    });

    it('collects a vararg into an array', function() {
      var s = 'thing { param String users... "u"; at $; }';
      assert.deepStrictEqual(
        apply('thing alice bob carol;', s).children[0].values.users,
        ['alice', 'bob', 'carol']);
    });

    it('lets a vararg match zero arguments', function() {
      // This is why `run_as;` with no users parses -- the manual.test script
      // that expected a rejection had gone stale, not the product.
      var s = 'thing { param String users... "u"; at $; }';
      assert.strictEqual(apply('thing;', s).children[0].values.users, undefined);
    });
  });

  describe('placement', function() {
    var SCHEMA = [
      'outer { at $; }',
      'inner { at outer; }',
      'anywhere { at $ outer; }'
    ].join('\n');

    it('accepts a directive at a permitted location', function() {
      assert.doesNotThrow(function() { apply('outer { inner; }', SCHEMA); });
    });

    it('accepts a directive permitted in more than one place', function() {
      assert.doesNotThrow(function() {
        apply('anywhere;\nouter { anywhere; }', SCHEMA);
      });
    });

    it('rejects a directive at the root when it belongs in a scope', function() {
      assertRejects('inner;', SCHEMA, /inner directive can't be used here/);
    });

    it('rejects a directive nested where it does not belong', function() {
      assertRejects('outer { outer; }', SCHEMA, /outer directive can't be used here/);
    });

    it('rejects an unknown directive', function() {
      assertRejects('mystery;', SCHEMA, /Unknown directive "mystery"/);
    });

    it('annotates the error with file, line and column', function() {
      assertRejects('outer {\n  inner;\n  inner;\n}',
        'outer { at $; }\ninner { at outer; maxcount 1; }',
        /\/tmp\/test\.conf:3:3/);
    });
  });

  describe('maxcount', function() {
    var SCHEMA = 'once { at $; maxcount 1; }\nmany { at $; }';

    it('accepts a directive up to its limit', function() {
      assert.doesNotThrow(function() { apply('once;', SCHEMA); });
    });

    it('rejects a directive past its limit', function() {
      assertRejects('once; once;', SCHEMA, /once directive appears too many times/);
    });

    it('has no limit by default', function() {
      assert.doesNotThrow(function() { apply('many; many; many;', SCHEMA); });
    });

    it('counts per scope, not globally', function() {
      var s = 'scope { at $; }\nonce { at scope; maxcount 1; }';
      assert.doesNotThrow(function() {
        apply('scope { once; }\nscope { once; }', s);
      });
    });
  });

  describe('precludes', function() {
    var SCHEMA = [
      'scope { at $; }',
      'alpha { at scope; precludes beta; }',
      'beta { at scope; }'
    ].join('\n');

    it('accepts either directive alone', function() {
      assert.doesNotThrow(function() { apply('scope { alpha; }', SCHEMA); });
      assert.doesNotThrow(function() { apply('scope { beta; }', SCHEMA); });
    });

    it('rejects the two together', function() {
      assertRejects('scope { beta; alpha; }', SCHEMA,
        /alpha and beta directives are mutually exclusive/);
    });
  });

  describe('the schema language itself', function() {
    it('rejects a rule with no "at"', function() {
      assertRejects('thing;', 'thing { param String x "d"; }',
        /Missing "at" directive/);
    });

    it('rejects an unknown parameter type', function() {
      assertRejects('thing x;', 'thing { param Widget x "d"; at $; }',
        /Unknown type "Widget"/);
    });

    it('rejects duplicate parameter names', function() {
      assertRejects('thing a b;',
        'thing { param String x "d"; param String x "d"; at $; }',
        /Not all param names were unique/);
    });

    it('rejects a required parameter after an optional one', function() {
      assertRejects('thing a b;',
        'thing { param String [x] "d"; param String y "d"; at $; }',
        /Required parameter defined after non-required/);
    });

    it('rejects a default value on a required parameter', function() {
      assertRejects('thing a;',
        'thing { param String x "d" somedefault; at $; }',
        /Only optional parameters can have default values/);
    });

    it('rejects an under-specified param', function() {
      assertRejects('thing a;', 'thing { param String x; at $; }',
        /Invalid schema specification/);
    });
  });

  describe('the real shiny-server-rules.config', function() {
    var schemaText;

    before(function() {
      schemaText = require('fs').readFileSync(
        paths.projectFile('config/shiny-server-rules.config'), 'utf8');
    });

    function applyReal(configText) {
      return schema.applySchema(
        config.parse(configText, '/tmp/test.conf'),
        config.parse(schemaText, 'shiny-server-rules.config'));
    }

    it('validates a minimal working config', function() {
      var root = applyReal([
        'run_as shiny;',
        'server {',
        '  listen 3838;',
        '  location / {',
        '    site_dir /srv/shiny-server;',
        '    log_dir /var/log/shiny-server;',
        '    directory_index on;',
        '  }',
        '}'
      ].join('\n'));

      var listen = root.search('listen', false)[0];
      assert.strictEqual(listen.values.port, 3838);
      assert.strictEqual(typeof listen.values.port, 'number');
    });

    it('accepts port 0, which means "pick an ephemeral port"', function() {
      // Relied on by the integration harness; also the reason
      // config-router.js's permission check exempts port 0.
      var root = applyReal('run_as shiny;\nserver { listen 0 127.0.0.1; }');
      assert.strictEqual(root.search('listen', false)[0].values.port, 0);
    });

    it('accepts run_as with no users, thanks to its vararg', function() {
      assert.doesNotThrow(function() { applyReal('run_as;'); });
    });

    it('rejects a directive in the wrong scope', function() {
      assert.throws(function() {
        applyReal('listen 3838;');
      }, /can't be used here/);
    });

    it('rejects a misspelled directive', function() {
      assert.throws(function() {
        applyReal('run_as shiny;\nserver { listne 3838; }');
      }, /Unknown directive "listne"/);
    });
  });
});
