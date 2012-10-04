var util = require('util');
var events = require('events');

var expect = require('expect.js');

var ll = require("../lazylines");

describe('lazylines', function(){
    it("", function (done) {
        var reader = new StringReadStream();
        var inp = new ll.LineReadStream(reader);

        var collected = "";
        inp.on("line", function (line) {
            collected += line + "#";
        });
        inp.on("end", function () {
            expect(collected).to.be("first\n#second\n#third\n#\n#last#");
            done();
        });

        reader.feed(5, "first\nsecond\nthird\n\nlast"
        );
    });
});


function StringReadStream() {
}
util.inherits(StringReadStream, events.EventEmitter);

StringReadStream.prototype.feed = function (limit, buffer) {
    var that = this;
    function feedNext() {
        // Write chunks that are as long as limit
        if (buffer.length >= limit) {
            that.emit("data", buffer.slice(0, limit));
            buffer = buffer.slice(limit);
            process.nextTick(feedNext);
        } else if (buffer.length > 0) {
            that.emit("data", buffer);
            buffer = "";
            process.nextTick(feedNext);
        } else {
            that.emit("end");
        }
    }
    process.nextTick(feedNext);
};
