/*
 * pidfile.js
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

// Acquiring and releasing the pidfile named by --pidfile.
//
// This used to be fsutil.createPidFile plus an unlink in a lib/main.js exit
// handler. It lives on its own because it is the one piece of startup that can
// destroy data, and because welded to optimist.argv and process.on('exit') it
// was untestable.
//
// Locking is a BSD flock(2)-style descriptor lock, acquired for us by a
// short-lived external helper (`flock` on Linux, `lockf` on macOS):
//
// 1. We open the pidfile read/write without truncating it.
// 2. We pass that open descriptor to the helper as its fd 3.
// 3. The helper takes an exclusive, nonblocking lock on fd 3 and exits.
// 4. Our descriptor refers to the same open file description, so the lock
//    remains held after the helper exits.
// 5. We keep the descriptor open until release() or process exit; the kernel
//    drops the lock when the last descriptor for it closes.
//
// No helper process stays alive after acquisition, and the server keeps its
// own PID and signal topology (unlike running under a `flock` wrapper, which
// would change $MAINPID and the PID written to the file).
//
// Note this is a different lock domain than the fcntl(F_SETLK) record lock
// used before. Package upgrades stop the old service before starting the new
// one, so the supported upgrade path never overlaps them; manually running
// old and new servers against the same pidfile is unsupported.

var child_process = require('child_process');
var fs = require('fs');
var path = require('path');

// A pidfile holds one decimal process ID and nothing else. We only ever read a
// prefix, since the whole point is to recognise a file that is *not* a pidfile
// -- which may be arbitrarily large.
var PID_PATTERN = /^\s*\d+\s*$/;
var READ_LIMIT = 4096;

// Both helpers report lock contention as EX_TEMPFAIL. It is the ONLY status
// translated to LOCKED; anything else is an operational startup error.
var LOCK_CONTENTION_STATUS = 75;

// Defensive timeout: both helpers are invoked in explicitly nonblocking mode,
// so a longer runtime indicates a broken helper or platform.
var LOCK_HELPER_TIMEOUT_MS = 5000;

// Ownership records: absolute path -> {fd, dev, ino}. Matching file contents
// alone are no longer proof of ownership; release() requires a successful
// acquisition by this module.
var owned = new Map();

/** Another process holds the lock. */
exports.LOCKED = 'locked';
/** The path exists but holds something other than a process ID. */
exports.NOT_A_PIDFILE = 'not-a-pidfile';

function lockHelperPaths() {
  if (process.platform === 'linux')
    return {name: 'flock', paths: ['/usr/bin/flock', '/bin/flock'],
      args: ['-n', '-E', String(LOCK_CONTENTION_STATUS), '3']};
  if (process.platform === 'darwin')
    return {name: 'lockf', paths: ['/usr/bin/lockf'],
      args: ['-s', '-t', '0', '3']};
  throw new Error(
    'Pidfile locking is not supported on platform "' + process.platform +
    '" (supported: linux, darwin).');
}

// Rewireable for tests.
function resolveLockHelper() {
  var helper = lockHelperPaths();
  for (var i = 0; i < helper.paths.length; i++) {
    if (fs.existsSync(helper.paths[i]))
      return {command: helper.paths[i], args: helper.args};
  }
  throw new Error(
    'Cannot lock the pidfile: the "' + helper.name + '" utility was not ' +
    'found in ' + helper.paths.join(' or ') + ' (platform: ' +
    process.platform + '). Install it, or run without --pidfile.');
}

/**
 * Takes the BSD lock on the open file description behind `fd`, by passing the
 * descriptor as fd 3 to a short-lived helper. Returns false on contention;
 * throws on any infrastructure failure.
 */
function acquireLock(fd, filePath) {
  var helper = resolveLockHelper();
  var result = child_process.spawnSync(helper.command, helper.args, {
    // The helper locks its fd 3, which shares our open file description.
    stdio: ['ignore', 'ignore', 'pipe', fd],
    encoding: 'utf8',
    timeout: LOCK_HELPER_TIMEOUT_MS
  });

  if (result.error) {
    var reason = result.error.code === 'ETIMEDOUT' ?
      'did not finish within ' + LOCK_HELPER_TIMEOUT_MS + 'ms' :
      'could not be started (' + result.error.message + ')';
    throw new Error('Cannot lock pidfile ' + filePath + ': ' +
      helper.command + ' ' + reason);
  }
  if (result.signal) {
    throw new Error('Cannot lock pidfile ' + filePath + ': ' +
      helper.command + ' was killed by signal ' + result.signal);
  }
  if (result.status === 0)
    return true;
  if (result.status === LOCK_CONTENTION_STATUS)
    return false;
  throw new Error('Cannot lock pidfile ' + filePath + ': ' + helper.command +
    ' exited with unexpected status ' + result.status +
    (result.stderr && result.stderr.trim() ? ': ' + result.stderr.trim() : ''));
}

/**
 * Locks `path` and writes this process's ID to it.
 *
 * The file descriptor is intentionally left open for the life of the process:
 * the lock is dropped as soon as the last descriptor for the open file
 * description is closed, so closing it here would silently release the lock.
 *
 * @param {string} path - Absolute path to the pidfile.
 * @returns {object} `{ok: true}`, or `{ok: false, reason, message}` where
 *   reason is LOCKED or NOT_A_PIDFILE and message is fit to show a user.
 */
exports.acquire = acquire;
function acquire(filePath) {
  filePath = path.resolve(filePath);
  var fd = fs.openSync(filePath, 'a+', 0600);

  var lockAcquired;
  try {
    lockAcquired = acquireLock(fd, filePath);
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
  if (!lockAcquired) {
    fs.closeSync(fd);
    return {
      ok: false,
      reason: exports.LOCKED,
      message: 'Could not lock pidfile. Is another instance of ' +
               'Shiny Server running?'
    };
  }

  // Check what's there *before* truncating. Without this, a mistyped
  // --pidfile silently destroys whatever it points at -- and since the server
  // usually runs as root and takes both a pidfile and a config path on the
  // same command line, `--pidfile /etc/shiny-server/shiny-server.conf` is an
  // easy thing to type and an expensive thing to do.
  var size = fs.fstatSync(fd).size;
  if (size > 0) {
    var buf = Buffer.alloc(Math.min(size, READ_LIMIT));
    var bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    var existing = buf.toString('ascii', 0, bytesRead);
    if (!PID_PATTERN.test(existing)) {
      fs.closeSync(fd);
      return {
        ok: false,
        reason: exports.NOT_A_PIDFILE,
        message: filePath + ' does not look like a pidfile (expected a ' +
                 'process ID, found ' + size + ' bytes of other content). ' +
                 'Refusing to overwrite it.'
      };
    }
  }

  var pidBuf = Buffer.from(process.pid + '', 'ascii');
  fs.ftruncateSync(fd, 0);
  var pos = 0;
  while (pos < pidBuf.length)
    pos += fs.writeSync(fd, pidBuf, pos, pidBuf.length - pos, pos);

  var identity = fs.fstatSync(fd);
  owned.set(filePath, {fd: fd, dev: identity.dev, ino: identity.ino});
  return {ok: true};
}

/**
 * Removes the pidfile, but only if this module acquired it, the pathname
 * still identifies the held inode, and the file still holds this process's
 * ID.
 *
 * Deleting it unconditionally would mean that a process which lost its lock --
 * or was never really the owner -- takes the live instance's pidfile with it
 * on the way out. If the path was removed or replaced since acquisition, the
 * held descriptor is closed (releasing the lock) but the replacement is left
 * alone.
 *
 * Synchronous on purpose: the caller is a process 'exit' handler, where queued
 * async I/O is not guaranteed to run at all.
 *
 * @returns {boolean} true if this call removed the file.
 */
exports.release = release;
function release(filePath) {
  filePath = path.resolve(filePath);
  var record = owned.get(filePath);
  if (!record)
    return false; // Never acquired by this module; not ours to remove.

  try {
    var stat = null;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      // The pathname is gone; nothing to unlink.
    }
    if (!stat || stat.dev !== record.dev || stat.ino !== record.ino)
      return false; // Replaced since acquisition; don't unlink the replacement.

    var buf = Buffer.alloc(READ_LIMIT);
    var bytesRead = fs.readSync(record.fd, buf, 0, buf.length, 0);
    var contents = buf.toString('ascii', 0, bytesRead);
    if (contents.trim() !== String(process.pid))
      return false;

    try {
      // Unlink while still holding the lock.
      fs.unlinkSync(filePath);
      return true;
    } catch (err) {
      return false;
    }
  } finally {
    // Closing the descriptor releases the lock.
    try {
      fs.closeSync(record.fd);
    } catch (err) {
      // Already closed; the lock is gone either way.
    }
    owned.delete(filePath);
  }
}
