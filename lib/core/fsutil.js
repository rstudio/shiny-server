/*
 * fsutil.js
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
var fs = require('graceful-fs');
var Q = require('q');
var util = require('util');
var posix = require('../../build/Release/posix');

exports.directoryExistsSync = directoryExistsSync;
/**
 * Returns true if the path exists and is a directory, false otherwise.
 */
function directoryExistsSync(path) {
  try {
    var stats = fs.statSync(path);
    return stats.isDirectory();
  } catch (e) {
    if (e.code === 'ENOENT')
      return false;
    throw e;
  }
}

exports.safeTail_p = safeTail_p;
/**
 * Safely read the tail end of the given file, if it exists, and return as a
 * string ("" is returned if the file cannot be read for any reason).
 *
 * If the file length is less than or equal to maxlen, the whole file is
 * returned. Otherwise, maxlen bytes are taken from the end and decoded
 * according to the specified encoding, then everything up to and including
 * the first line feed character is removed (if there is no line feed character
 * then nothing is removed).
 *
 * @param {String} path - The path of the file to read (or falsy to return "").
 * @param {Number} maxlen - The number of bytes to read, at maximum.
 * @param {String} [encoding] - The encoding to use to decode the bytes;
 *   defaults to "utf8".
 */
function safeTail_p(path, maxlen, encoding) {
  if (!path)
    return Q.resolve('');

  var defer = Q.defer();

  encoding = encoding || 'utf8';  
  
  Q.nfcall(fs.open, path, 'r')
  .then(function(fd) {
    return Q.nfcall(fs.fstat, fd)
    .then(function(stat) {
      var len = stat.size;
      if (len == 0)
        return '';

      var index = Math.max(0, len - maxlen);
      var bytesToRead = len - index;
      var buffer = new Buffer(bytesToRead);

      return Q.nfcall(fs.read, fd, buffer, 0, bytesToRead, index)
      .then(function(result) {
        var pos = 0;
        // Skip UTF-8 continuation bytes
        while (pos < result[0] && buffer.readUInt8(pos) >= 0x80) {
          pos++;
        }
        var str = buffer.toString(encoding, pos, result[0]);
        if (index != 0) {
          str = str.substring(str.indexOf('\n') + 1, str.length);
        }
        return str;
      });
    })
    .fin(function() {
      fs.close(fd, function(err) {
        if (err)
          logger.error("Couldn't close safeTail_p fd: " + err.message);
      });
    });
  })
  .then(
    function(val) {
      defer.resolve(val);
    },
    function(err) {
      logger.error(err);
      defer.resolve('');
    }
  )
  .done();

  return defer.promise;
}

exports.safeStat_p = safeStat_p;
function safeStat_p(path) {
  var deferred = Q.defer();
  fs.stat(path, function(err, stat) {
    if (err)
      deferred.resolve(null);
    else
      deferred.resolve(stat);
  })
  return deferred.promise;
}

var F_WRLCK = 1;
var SEEK_SET = 0;

exports.createPidFile = createPidFile;
function createPidFile(path) {
  var fd = fs.openSync(path, 'a+', 0600);
  if (!posix.acquireRecordLock(fd, F_WRLCK, SEEK_SET, 0, 0)) {
    return false;
  }

  var buf = new Buffer(process.pid + '', 'ascii');
  fs.truncateSync(fd, 0);
  var pos = 0;
  while (pos < buf.length)
    pos += fs.writeSync(fd, buf, pos, buf.length - pos, pos);

  return true;
}
