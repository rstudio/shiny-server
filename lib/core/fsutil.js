var fs = require('fs');
var Q = require('q');
var util = require('util');

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
        // TODO: Multi-byte encodings can break if we start just anywhere
        var str = buffer.toString(encoding, 0, result[0]);
        if (index != 0) {
          str = str.substring(str.indexOf('\n') + 1, str.length);
        }
        return str;
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