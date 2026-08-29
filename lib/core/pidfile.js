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

var fs = require('fs');
var posix = require('../../build/Release/posix');

var F_WRLCK = 1;
var SEEK_SET = 0;

// A pidfile holds one decimal process ID and nothing else. We only ever read a
// prefix, since the whole point is to recognise a file that is *not* a pidfile
// -- which may be arbitrarily large.
var PID_PATTERN = /^\s*\d+\s*$/;
var READ_LIMIT = 4096;

/** Another process holds the lock. */
exports.LOCKED = 'locked';
/** The path exists but holds something other than a process ID. */
exports.NOT_A_PIDFILE = 'not-a-pidfile';

/**
 * Locks `path` and writes this process's ID to it.
 *
 * The file descriptor is intentionally left open for the life of the process:
 * a POSIX record lock is dropped as soon as *any* descriptor for the file is
 * closed, so closing it here would silently release the lock.
 *
 * @param {string} path - Absolute path to the pidfile.
 * @returns {object} `{ok: true}`, or `{ok: false, reason, message}` where
 *   reason is LOCKED or NOT_A_PIDFILE and message is fit to show a user.
 */
exports.acquire = acquire;
function acquire(path) {
  var fd = fs.openSync(path, 'a+', 0600);

  if (!posix.acquireRecordLock(fd, F_WRLCK, SEEK_SET, 0, 0)) {
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
        message: path + ' does not look like a pidfile (expected a process ' +
                 'ID, found ' + size + ' bytes of other content). Refusing ' +
                 'to overwrite it.'
      };
    }
  }

  var pidBuf = Buffer.from(process.pid + '', 'ascii');
  fs.ftruncateSync(fd, 0);
  var pos = 0;
  while (pos < pidBuf.length)
    pos += fs.writeSync(fd, pidBuf, pos, pidBuf.length - pos, pos);

  return {ok: true};
}

/**
 * Removes the pidfile, but only if it still holds this process's ID.
 *
 * Deleting it unconditionally would mean that a process which lost its lock --
 * or was never really the owner -- takes the live instance's pidfile with it
 * on the way out.
 *
 * Synchronous on purpose: the caller is a process 'exit' handler, where queued
 * async I/O is not guaranteed to run at all.
 *
 * @returns {boolean} true if this call removed the file.
 */
exports.release = release;
function release(path) {
  var contents;
  try {
    contents = fs.readFileSync(path, 'ascii');
  } catch (err) {
    return false; // Already gone, or never ours to read.
  }

  if (contents.trim() !== String(process.pid))
    return false;

  try {
    fs.unlinkSync(path);
    return true;
  } catch (err) {
    return false;
  }
}
