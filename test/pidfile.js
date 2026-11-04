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
var rewire = require('rewire');
var pidfile = require('../lib/core/pidfile');
var config = require('./support/config');

describe('pidfile', function() {
  var dir;
  var target;

  beforeEach(function() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiny-server-pidfile-'));
    target = path.join(dir, 'shiny-server.pid');
  });

  afterEach(function() {
    // Don't leak held descriptors/locks between tests.
    pidfile.release(target);
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
      // Needs a genuinely separate process: the lock is a BSD descriptor lock
      // on the open file description, and a fresh open() in *this* process is
      // a different description -- but keeping the contention in a child also
      // proves the lock is really held across processes.
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
      // The child acquires and exits; its descriptors close and the kernel
      // drops the lock.
      var acquired = runInChild(
        'var p = require(' + JSON.stringify(pidfilePath()) + ');' +
        'process.stdout.write(JSON.stringify(p.acquire(' +
        JSON.stringify(target) + ')));'
      );
      assert.strictEqual(acquired.ok, true);

      assert.strictEqual(pidfile.acquire(target).ok, true);
      assert.strictEqual(fs.readFileSync(target, 'ascii'), String(process.pid));
    });

    it('a killed child leaves a stale file but no live lock', function() {
      this.timeout(15000);
      // SIGKILL runs no exit handlers: the file stays behind, but the kernel
      // still releases the lock when the child's descriptors close.
      var child = child_process.spawn(process.execPath, ['-e',
        'var p = require(' + JSON.stringify(pidfilePath()) + ');' +
        'var r = p.acquire(' + JSON.stringify(target) + ');' +
        'if (!r.ok) { console.error(r.message); process.exit(1); }' +
        'setTimeout(function() {}, 1e9);'
      ]);
      return waitFor(function() {
        return fs.existsSync(target) &&
          fs.readFileSync(target, 'ascii').trim() === String(child.pid);
      }, 10000)
      .then(function() {
        child.kill('SIGKILL');
        return new Promise(function(resolve) {
          child.on('exit', function() { resolve(); });
        });
      })
      .then(function() {
        // Stale contents, live takeover.
        assert.strictEqual(fs.readFileSync(target, 'ascii'),
          String(child.pid));
        assert.strictEqual(pidfile.acquire(target).ok, true);
        assert.strictEqual(fs.readFileSync(target, 'ascii'),
          String(process.pid));
      });
    });
  });

  describe('lock helper failures', function() {
    // A rewired copy per test, so stubbed spawnSync/resolveLockHelper never
    // leak into the behavioral tests above.
    function rewiredPidfile(spawnSyncResult) {
      var pf = rewire('../lib/core/pidfile');
      pf.__set__('child_process', {
        spawnSync: function() { return spawnSyncResult; }
      });
      return pf;
    }

    it('reports a missing helper as a specific error, not "another instance"',
      function() {
        var pf = rewire('../lib/core/pidfile');
        pf.__set__('fs', {existsSync: function() { return false; }});
        assert.throws(function() {
          pf.__get__('resolveLockHelper')();
        }, /utility was not found/);
      });

    it('translates only status 75 to LOCKED', function() {
      assert.strictEqual(
        rewiredPidfile({status: 75}).acquire(target).reason, pidfile.LOCKED);

      [0, 1, 2, 74, 76, 127].forEach(function(status) {
        var pf = rewiredPidfile({status: status, stderr: ''});
        if (status === 0) {
          assert.strictEqual(pf.acquire(target).ok, true);
          pf.release(target);
        } else {
          assert.throws(function() { pf.acquire(target); },
            new RegExp('unexpected status ' + status));
        }
      });
    });

    it('treats a helper killed by a signal as an operational error',
      function() {
        var pf = rewiredPidfile({status: null, signal: 'SIGTERM'});
        assert.throws(function() { pf.acquire(target); }, /signal SIGTERM/);
      });

    it('treats a helper that cannot be started as an operational error',
      function() {
        var pf = rewiredPidfile({error: new Error('spawn flock ENOENT')});
        assert.throws(function() { pf.acquire(target); },
          /could not be started/);
      });

    it('treats a helper timeout as an operational error', function() {
      var err = new Error('spawnSync flock ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      var pf = rewiredPidfile({error: err, signal: 'SIGTERM'});
      assert.throws(function() { pf.acquire(target); }, /did not finish/);
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

    it('refuses a matching-pid file this module never acquired', function() {
      // Contents alone are not proof of ownership.
      fs.writeFileSync(target, String(process.pid));
      assert.strictEqual(pidfile.release(target), false);
      assert.strictEqual(fs.readFileSync(target, 'ascii'),
        String(process.pid));
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
      pidfile.acquire(target);
      fs.appendFileSync(target, '\n');
      assert.strictEqual(pidfile.release(target), true);
      assert.strictEqual(fs.existsSync(target), false);
    });

    it('does not unlink a replacement created after acquisition', function() {
      pidfile.acquire(target);
      // Someone removes our pidfile and drops a new one -- even one that
      // happens to contain our pid. It is not ours to delete.
      fs.unlinkSync(target);
      fs.writeFileSync(target, String(process.pid));
      assert.strictEqual(pidfile.release(target), false);
      assert.strictEqual(fs.readFileSync(target, 'ascii'),
        String(process.pid));
    });

    it('closes the descriptor, allowing immediate reacquisition', function() {
      assert.strictEqual(pidfile.acquire(target).ok, true);
      assert.strictEqual(pidfile.release(target), true);
      // The lock must be gone: a fresh acquire (new descriptor, same file)
      // succeeds at once.
      fs.writeFileSync(target, '');
      assert.strictEqual(pidfile.acquire(target).ok, true);
      assert.strictEqual(pidfile.release(target), true);
    });

    it('can be called twice', function() {
      pidfile.acquire(target);
      assert.strictEqual(pidfile.release(target), true);
      assert.strictEqual(pidfile.release(target), false);
    });
  });

  describe('command line', function() {
    this.timeout(30000);

    var server;

    afterEach(function() {
      if (server && server.exitCode === null && server.signalCode === null) {
        server.kill('SIGKILL');
      }
      server = null;
    });

    function startServer(conf) {
      server = child_process.spawn(process.execPath,
        [path.join(__dirname, '..', 'lib', 'main.js'),
          '--pidfile=' + target, conf.path],
        {stdio: ['ignore', 'pipe', 'pipe']});
      // Drain so a full pipe can never block the child.
      server.stdout.on('data', function() {});
      server.stderr.on('data', function() {});
      return waitFor(function() {
        return fs.existsSync(target) &&
          fs.readFileSync(target, 'ascii').trim() === String(server.pid);
      }, 15000);
    }

    function exit_p(proc) {
      return new Promise(function(resolve) {
        proc.on('exit', function(code, signal) { resolve({code: code, signal: signal}); });
      });
    }

    it('excludes a second instance and cleans up per exit kind', async function() {
      var conf = config.write(config.siteDirConfig(),
        {'site/index.html': 'hello'});
      try {
        // 1. First process starts and writes its PID.
        await startServer(conf);

        // 2. Second process exits with the "another instance" message.
        var second = child_process.spawnSync(process.execPath,
          [path.join(__dirname, '..', 'lib', 'main.js'),
            '--pidfile=' + target, conf.path],
          {encoding: 'utf8', timeout: 15000});
        assert.strictEqual(second.status, 1,
          'second instance should fail: ' + second.stderr);
        assert.ok(/another instance/i.test(second.stderr),
          'unhelpful message: ' + second.stderr);

        // 3. Terminating the first removes the pidfile.
        server.kill('SIGTERM');
        await exit_p(server);
        assert.strictEqual(fs.existsSync(target), false,
          'graceful exit should remove the pidfile');

        // 4. Killing it ungracefully leaves the file but permits takeover.
        await startServer(conf);
        var stalePid = server.pid;
        server.kill('SIGKILL');
        await exit_p(server);
        assert.strictEqual(fs.readFileSync(target, 'ascii').trim(),
          String(stalePid), 'SIGKILL should leave the pidfile behind');

        assert.strictEqual(pidfile.acquire(target).ok, true);
        assert.strictEqual(fs.readFileSync(target, 'ascii'),
          String(process.pid));
        assert.strictEqual(pidfile.release(target), true);
      } finally {
        conf.cleanup();
      }
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

/**
 * Polls `predicate` until it returns true or the deadline passes.
 */
function waitFor(predicate, timeoutMs) {
  var deadline = Date.now() + timeoutMs;
  return new Promise(function(resolve, reject) {
    function check() {
      var ok = false;
      try {
        ok = predicate();
      } catch (err) {
        // Not ready yet.
      }
      if (ok) {
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error('Timed out waiting for condition'));
      } else {
        setTimeout(check, 50);
      }
    }
    check();
  });
}
