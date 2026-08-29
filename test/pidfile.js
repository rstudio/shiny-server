/*
 * test/pidfile.js
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
var fs = require('fs');
var os = require('os');
var path = require('path');
var pidfile = require('../lib/core/pidfile');

describe('pidfile', function() {
  var dir;
  var target;

  beforeEach(function() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiny-server-pidfile-'));
    target = path.join(dir, 'shiny-server.pid');
  });

  afterEach(function() {
    try {
      fs.rmSync(dir, {recursive: true, force: true});
    } catch (err) {
      // A leftover temp dir isn't worth failing a test over.
    }
  });

  describe('acquire', function() {
    it('creates the file and writes our pid', function() {
      var result = pidfile.acquire(target);
      assert.deepStrictEqual(result, {ok: true});
      assert.strictEqual(fs.readFileSync(target, 'ascii'), String(process.pid));
    });

    it('creates the file with 0600 permissions', function() {
      pidfile.acquire(target);
      var mode = fs.statSync(target).mode & 0o777;
      // The pidfile records a pid we act on; it should not be world-writable.
      assert.strictEqual(mode & 0o022, 0,
        'unexpectedly group/world writable: ' + mode.toString(8));
    });

    it('overwrites a stale pidfile from a previous run', function() {
      // The common case after a crash: the file is left behind holding a pid
      // that no longer exists. It's still a pidfile, so take it over.
      fs.writeFileSync(target, '999999');
      var result = pidfile.acquire(target);
      assert.deepStrictEqual(result, {ok: true});
      assert.strictEqual(fs.readFileSync(target, 'ascii'), String(process.pid));
    });

    it('accepts a pidfile with trailing whitespace', function() {
      fs.writeFileSync(target, '12345\n');
      assert.strictEqual(pidfile.acquire(target).ok, true);
    });

    it('accepts an existing empty file', function() {
      fs.writeFileSync(target, '');
      assert.strictEqual(pidfile.acquire(target).ok, true);
      assert.strictEqual(fs.readFileSync(target, 'ascii'), String(process.pid));
    });

    describe('refusing to clobber a file that is not a pidfile', function() {
      // The bug this guards: --pidfile takes a path, and so does the config
      // argument. Mistyping one as the other used to truncate the target to
      // zero and then delete it on exit -- as root, in production.
      var NOT_PIDFILES = {
        'a config file': 'run_as shiny;\n\nserver {\n  listen 3838;\n}\n',
        'text with a number in it': 'pid was 1234 yesterday',
        'a number followed by other content': '1234\nand then some prose',
        'whitespace only': '   \n\t\n',
        'binary junk': ''
      };

      Object.keys(NOT_PIDFILES).forEach(function(what) {
        it('refuses ' + what + ', leaving it byte-identical', function() {
          var original = NOT_PIDFILES[what];
          fs.writeFileSync(target, original);
          var before = fs.readFileSync(target);

          var result = pidfile.acquire(target);

          assert.strictEqual(result.ok, false);
          assert.strictEqual(result.reason, pidfile.NOT_A_PIDFILE);
          assert.ok(/does not look like a pidfile/.test(result.message),
            'unhelpful message: ' + result.message);
          assert.ok(result.message.indexOf(target) >= 0,
            'message should name the path: ' + result.message);
          assert.deepStrictEqual(fs.readFileSync(target), before,
            'the file was modified despite being refused');
        });
      });

      it('refuses a large file without reading all of it', function() {
        // A config or log file could be arbitrarily large; recognising that it
        // is not a pidfile must not depend on slurping the whole thing.
        var big = 'x'.repeat(5 * 1024 * 1024);
        fs.writeFileSync(target, big);
        var result = pidfile.acquire(target);
        assert.strictEqual(result.reason, pidfile.NOT_A_PIDFILE);
        assert.strictEqual(fs.statSync(target).size, big.length);
        // The message reports the true size, not the amount read.
        assert.ok(result.message.indexOf(String(big.length)) >= 0,
          'message should report the real size: ' + result.message);
      });
    });

    it('refuses when another process holds the lock', function() {
      // Needs a genuinely separate process: POSIX record locks are per-process,
      // so a second acquire() in *this* process would happily succeed.
      //
      // This runs everywhere. It used to have to be skipped off Linux, because
      // the F_WRLCK value was hardcoded to Linux's 1 -- which on macOS/BSD is
      // F_RDLCK, a shared lock that two instances can hold at once. The
      // constant now comes from the native addon.
      assert.strictEqual(pidfile.acquire(target).ok, true);

      var result = runInChild(
        'var p = require(' + JSON.stringify(pidfilePath()) + ');' +
        'process.stdout.write(JSON.stringify(p.acquire(' +
        JSON.stringify(target) + ')));'
      );

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, pidfile.LOCKED);
      assert.ok(/another instance/i.test(result.message),
        'unhelpful message: ' + result.message);
    });

    it('lets a second process take over once the first has exited', function() {
      // The child acquires and exits; its lock dies with it.
      var acquired = runInChild(
        'var p = require(' + JSON.stringify(pidfilePath()) + ');' +
        'process.stdout.write(JSON.stringify(p.acquire(' +
        JSON.stringify(target) + ')));'
      );
      assert.strictEqual(acquired.ok, true);

      assert.strictEqual(pidfile.acquire(target).ok, true);
      assert.strictEqual(fs.readFileSync(target, 'ascii'), String(process.pid));
    });
  });

  describe('release', function() {
    it('removes the file when it holds our pid', function() {
      pidfile.acquire(target);
      assert.strictEqual(pidfile.release(target), true);
      assert.strictEqual(fs.existsSync(target), false);
    });

    it('leaves a pidfile belonging to another process alone', function() {
      // If we lost the lock, or never really owned it, the live instance's
      // pidfile is not ours to delete.
      fs.writeFileSync(target, '999999');
      assert.strictEqual(pidfile.release(target), false);
      assert.strictEqual(fs.readFileSync(target, 'ascii'), '999999');
    });

    it('is a no-op when the file is already gone', function() {
      assert.strictEqual(pidfile.release(target), false);
    });

    it('is a no-op on a file that is not a pidfile', function() {
      var original = 'run_as shiny;\n';
      fs.writeFileSync(target, original);
      assert.strictEqual(pidfile.release(target), false);
      assert.strictEqual(fs.readFileSync(target, 'ascii'), original);
    });

    it('tolerates trailing whitespace around our pid', function() {
      fs.writeFileSync(target, process.pid + '\n');
      assert.strictEqual(pidfile.release(target), true);
      assert.strictEqual(fs.existsSync(target), false);
    });

    it('can be called twice', function() {
      pidfile.acquire(target);
      assert.strictEqual(pidfile.release(target), true);
      assert.strictEqual(pidfile.release(target), false);
    });
  });
});

function pidfilePath() {
  return path.join(__dirname, '..', 'lib', 'core', 'pidfile.js');
}

/**
 * Runs `source` in a fresh node process and parses its stdout as JSON. Used for
 * the lock tests, which are meaningless within a single process.
 */
function runInChild(source) {
  var proc = child_process.spawnSync(process.execPath, ['-e', source], {
    encoding: 'utf8',
    timeout: 30000
  });
  assert.strictEqual(proc.status, 0,
    'child failed: ' + (proc.stderr || '') + (proc.error || ''));
  return JSON.parse(proc.stdout);
}
