var util = require('util');
var events = require('events');
var fs = require("fs");

//---------------- LineReadStream

/**
 * The lines returned by this stream include line terminators (either "\n" or "\r\n").
 *
 * @param encoding optional
 */
function LineReadStream(reader, encoding) {
    var that = this;

    var previousText = null;
    reader.on("data", function(buffer) {
        var data = buffer.toString(encoding);

        while (data.length > 0) {
            var eolIndex = data.indexOf("\n");

            if (eolIndex >= 0) {
                var line = data.slice(0, eolIndex+1); // including the newline
                data = data.slice(eolIndex+1); // starting after the newline
                if (previousText !== null) {
                    that.emit('line', previousText + line);
                    previousText = null;
                } else {
                    that.emit('line', line);
                }
            } else {
                previousText = data;
                break;
            }
        }
    });
    reader.on("end", function () {
        if (previousText !== null) {
            that.emit('line', previousText);
        }
        that.emit("end");
    });
}
util.inherits(LineReadStream, events.EventEmitter);

/**
 * A LineReadStream only makes sense for text files.
 * This function creates a ReadStream for a file with meaningful defaults
 * and uses it to create a LineReadStream
 */
LineReadStream.fromFile = function (fileName) {
    return new LineReadStream(fs.createReadStream(fileName, { encoding: "utf8", bufferSize: 1024 }));
}

//---------------- Various utilities

function streamToString(stream, callback) {
    var str = "";
    stream.on('data', function (data) {
        str += data;
    });

    stream.on('end', function () {
        callback(str);
    });
}

//---------------- EOL handling tools

var RE_LINE = /^(.*)\r?\n$/;
/**
 * If line ends with a line break (either "\n" or "\r\n"), remove it.
 * Otherwise, return it unchanged.
 */
function chomp(line) {
    var match = RE_LINE.exec(line);
    if (match) {
        return match[1];
    } else {
        return line;
    }
}

function getPlatformEOL() {
    return process.platform === "win32" ? "\r\n" : "\n";
}

function extractEOL(str) {
    if (str.indexOf("\r\n") >= 0) {
        return "\r\n";
    } else if (str.indexOf("\n") >= 0) {
        return "\n";
    } else {
        // There is no EOL in the string
        return getPlatformEOL();
    }
}

//---------------- Exports

exports.LineReadStream = LineReadStream;
exports.chomp = chomp;
exports.getPlatformEOL = getPlatformEOL;
exports.extractEOL = extractEOL;
exports.streamToString = streamToString;