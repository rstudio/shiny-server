/*
 * test/user-db.js
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
var os = require('os');
var rewire = require('rewire');

// Each test that touches module state gets a fresh copy, so the caches and
// the stubbed child_process/platform never leak between tests.
function freshUserDb() {
  return rewire('../lib/core/user-db');
}

// Stubs child_process in a rewired module. `handler` is
// (command, args) -> {status, stdout} | {error}; anything with a nonzero
// status or an error is reported as a failure, matching execFile semantics.
function stubCommands(userDb, handler) {
  var calls = [];
  var fake = {
    execFile: function(command, args, options, callback) {
      calls.push({command: command, args: args});
      var result = handler(command, args);
      if (result.error) {
        callback(result.error);
      } else if (result.status) {
        var err = new Error('Command failed: ' + command);
        err.code = result.status;
        callback(err);
      } else {
        callback(null, result.stdout || '', result.stderr || '');
      }
    },
    execFileSync: function(command, args, options) {
      calls.push({command: command, args: args});
      var result = handler(command, args);
      if (result.error)
        throw result.error;
      if (result.status) {
        var err = new Error('Command failed: ' + command);
        err.status = result.status;
        err.stderr = result.stderr || '';
        throw err;
      }
      return result.stdout || '';
    }
  };
  userDb.__set__('child_process', fake);
  // Command resolution checks the real filesystem; bypass it.
  userDb.__set__('resolveCommand', function(config, spec) {
    return '/stubbed/' + spec.command;
  });
  return calls;
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

describe('user-db', function() {
  describe('parsing', function() {
    var userDb;
    beforeEach(function() {
      userDb = freshUserDb();
    });

    it('parses a Linux passwd record', function() {
      var parse = userDb.__get__('parseLinuxPasswd');
      assert.deepStrictEqual(
        parse('shiny:x:998:997:Shiny Server:/home/shiny:/bin/bash\n'),
        {name: 'shiny', uid: 998, gid: 997, home: '/home/shiny'});
    });

    it('parses a Darwin id -P record', function() {
      var parse = userDb.__get__('parseDarwinPasswd');
      assert.deepStrictEqual(
        parse('jcheng:*:501:20::0:0:Joe Cheng:/Users/jcheng:/bin/zsh\n'),
        {name: 'jcheng', uid: 501, gid: 20, home: '/Users/jcheng'});
    });

    it('rejects passwd records with the wrong field count', function() {
      var parse = userDb.__get__('parseLinuxPasswd');
      assert.throws(function() { parse('shiny:x:998\n'); }, /7 passwd fields/);
      var parseDarwin = userDb.__get__('parseDarwinPasswd');
      assert.throws(function() { parseDarwin('a:b:c:d:e:f:g\n'); },
        /10 id -P fields/);
    });

    it('rejects nonnumeric and out-of-range IDs', function() {
      var parse = userDb.__get__('parseLinuxPasswd');
      assert.throws(function() {
        parse('shiny:x:abc:997::/home/shiny:/bin/bash');
      }, /nonnegative integer/);
      assert.throws(function() {
        parse('shiny:x:99999999999999999999:997::/home/shiny:/bin/bash');
      }, /out of range/);
    });

    it('parses a Linux group record', function() {
      var parse = userDb.__get__('parseGroupEntry');
      assert.deepStrictEqual(parse('shiny:x:997:alice,bob\n'),
        {name: 'shiny', gid: 997});
      // Members may be absent entirely.
      assert.deepStrictEqual(parse('shiny:x:997:\n'),
        {name: 'shiny', gid: 997});
    });

    it('parses a dscacheutil group record', function() {
      var parse = userDb.__get__('parseDscacheutilGroup');
      assert.deepStrictEqual(
        parse('name: staff\npassword: *\ngid: 20\nusers: root alice\n'),
        {name: 'staff', gid: 20});
    });

    it('rejects a dscacheutil record missing name or gid', function() {
      var parse = userDb.__get__('parseDscacheutilGroup');
      assert.throws(function() { parse('name: staff\n'); }, /name and gid/);
    });

    it('parses group IDs with extra whitespace and duplicates', function() {
      var parse = userDb.__get__('parseGroupIds');
      assert.deepStrictEqual(parse('  20  20 701 12\t61\n'), [20, 701, 12, 61]);
    });

    it('rejects an empty group ID list', function() {
      var parse = userDb.__get__('parseGroupIds');
      assert.throws(function() { parse('  \n'); }, /at least one group ID/);
    });
  });

  describe('command results', function() {
    it('maps getent status 2 to null for users and groups', async function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'linux');
      stubCommands(userDb, function() { return {status: 2}; });
      assert.strictEqual(await userDb.lookupUser_p('nobodyxyz'), null);
      assert.strictEqual(userDb.lookupGroup('nosuchgroup'), null);
    });

    it('maps id status 1 to null on Darwin', async function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'darwin');
      stubCommands(userDb, function() { return {status: 1}; });
      assert.strictEqual(await userDb.lookupUser_p('nobodyxyz'), null);
      assert.strictEqual(await userDb.getGroupIds_p('nobodyxyz'), null);
    });

    it('treats empty dscacheutil output as null', function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'darwin');
      stubCommands(userDb, function() { return {status: 0, stdout: ''}; });
      assert.strictEqual(userDb.lookupGroup('nosuchgroup'), null);
    });

    it('passes the name as a single argv element after --', async function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'linux');
      var calls = stubCommands(userDb, function() {
        return {status: 0, stdout: 'weird:x:1:2::/home/weird:/bin/sh\n'};
      });
      // A name that would be dangerous if interpolated into a shell command.
      var name = 'evil; rm -rf / #';
      var user = await userDb.lookupUser_p(name);
      assert.strictEqual(user.name, 'weird');
      assert.deepStrictEqual(calls[0].args, ['--', 'passwd', name]);
    });

    it('throws on unexpected exit statuses', async function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'linux');
      stubCommands(userDb, function() {
        return {status: 3, stderr: 'boop'};
      });
      await assert.rejects(userDb.lookupUser_p('someone'), /status 3/);
    });

    it('throws when the command cannot be started', async function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'linux');
      stubCommands(userDb, function() {
        var err = new Error('spawn /stubbed/getent ENOENT');
        err.code = 'ENOENT';
        return {error: err};
      });
      await assert.rejects(userDb.lookupUser_p('someone'), /ENOENT/);
    });

    it('throws on malformed successful output', async function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'linux');
      stubCommands(userDb, function() {
        return {status: 0, stdout: 'this is not a passwd record\n'};
      });
      await assert.rejects(userDb.lookupUser_p('someone'), /malformed output/);
    });

    it('throws an actionable error when the utility is missing', async function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'linux');
      // No resolveCommand stub: real resolution against real search paths.
      userDb.__set__('fs', {existsSync: function() { return false; }});
      await assert.rejects(userDb.lookupUser_p('someone'),
        /"getent" utility was not found/);
    });

    it('throws on unsupported platforms', async function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'freebsd');
      await assert.rejects(userDb.lookupUser_p('someone'),
        /not supported on platform "freebsd"/);
      assert.throws(function() { userDb.lookupGroup('wheel'); },
        /not supported on platform "freebsd"/);
    });
  });

  describe('current-user fast path', function() {
    it('resolves the current user without running any command', async function() {
      var userDb = freshUserDb();
      var calls = stubCommands(userDb, function() {
        throw new Error('must not be called');
      });
      var info = os.userInfo();
      assert.deepStrictEqual(await userDb.lookupUser_p(info.username), {
        name: info.username,
        uid: info.uid,
        gid: info.gid,
        home: info.homedir
      });
      assert.strictEqual(calls.length, 0);
    });
  });

  describe('caching', function() {
    function countingUserDb(stdout) {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'linux');
      var count = 0;
      stubCommands(userDb, function() {
        count++;
        return {status: 0, stdout: stdout};
      });
      return {userDb: userDb, calls: function() { return count; }};
    }

    var PASSWD = 'alice:x:1001:1001::/home/alice:/bin/bash\n';

    it('caches positive results', async function() {
      var ctx = countingUserDb(PASSWD);
      await ctx.userDb.lookupUser_p('alice');
      await ctx.userDb.lookupUser_p('alice');
      assert.strictEqual(ctx.calls(), 1);
    });

    it('caches negative results', async function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'linux');
      var count = 0;
      stubCommands(userDb, function() {
        count++;
        return {status: 2};
      });
      assert.strictEqual(await userDb.lookupUser_p('ghost'), null);
      assert.strictEqual(await userDb.lookupUser_p('ghost'), null);
      assert.strictEqual(count, 1);
    });

    it('expires positive results after the positive TTL', async function() {
      var ctx = countingUserDb(PASSWD);
      ctx.userDb.__set__('POSITIVE_TTL_MS', 30);
      await ctx.userDb.lookupUser_p('alice');
      await sleep(60);
      await ctx.userDb.lookupUser_p('alice');
      assert.strictEqual(ctx.calls(), 2);
    });

    it('expires negative results after the shorter negative TTL', async function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'linux');
      userDb.__set__('POSITIVE_TTL_MS', 60000);
      userDb.__set__('NEGATIVE_TTL_MS', 30);
      var count = 0;
      stubCommands(userDb, function() {
        count++;
        return {status: 2};
      });
      await userDb.lookupUser_p('ghost');
      await sleep(60);
      await userDb.lookupUser_p('ghost');
      assert.strictEqual(count, 2);
    });

    it('evicts the oldest entry beyond the maximum size', async function() {
      var ctx = countingUserDb(PASSWD);
      ctx.userDb.__set__('MAX_CACHE_ENTRIES', 2);
      await ctx.userDb.lookupUser_p('alice');
      await ctx.userDb.lookupUser_p('bob');
      await ctx.userDb.lookupUser_p('carol');
      // alice was evicted; looking her up again re-runs the command.
      await ctx.userDb.lookupUser_p('alice');
      assert.strictEqual(ctx.calls(), 4);
    });

    it('coalesces concurrent lookups onto one command', async function() {
      var userDb = freshUserDb();
      userDb.__set__('platform', 'linux');
      var count = 0;
      var fake = {
        execFile: function(command, args, options, callback) {
          count++;
          // Resolve asynchronously so the second call arrives mid-flight.
          setImmediate(function() {
            callback(null, PASSWD, '');
          });
        }
      };
      userDb.__set__('child_process', fake);
      userDb.__set__('resolveCommand', function(config, spec) {
        return '/stubbed/' + spec.command;
      });
      var results = await Promise.all([
        userDb.lookupUser_p('alice'),
        userDb.lookupUser_p('alice'),
        userDb.lookupUser_p('alice')
      ]);
      assert.strictEqual(count, 1);
      results.forEach(function(user) {
        assert.strictEqual(user.name, 'alice');
      });
    });
  });

  // Live smoke tests against the real account commands for this platform.
  // Linux CI covers the Linux table; macOS developers cover the Darwin one.
  describe('live platform smoke tests', function() {
    var userDb = freshUserDb();
    var me = os.userInfo();

    it('lookupUser_p matches os.userInfo() for a non-current user path', async function() {
      // Force the command path by looking up via a rewired module whose
      // fast path is disabled.
      userDb.__set__('getCurrentUser', function() {
        return {name: '__definitely_not_me__', uid: -1, gid: -1, home: ''};
      });
      var user = await userDb.lookupUser_p(me.username);
      assert.deepStrictEqual(user, {
        name: me.username,
        uid: me.uid,
        gid: me.gid,
        home: me.homedir
      });
    });

    it('getGroupIds_p includes the current primary gid', async function() {
      var gids = await userDb.getGroupIds_p(me.username);
      assert.ok(Array.isArray(gids), 'expected an array');
      assert.ok(gids.indexOf(me.gid) >= 0,
        'expected ' + JSON.stringify(gids) + ' to include ' + me.gid);
    });

    it('lookupGroup resolves the current primary group', function() {
      var groupName = child_process.execFileSync('id', ['-gn'], {
        encoding: 'utf8'
      }).trim();
      var group = userDb.lookupGroup(groupName);
      assert.deepStrictEqual(group, {name: groupName, gid: me.gid});
    });
  });
});
