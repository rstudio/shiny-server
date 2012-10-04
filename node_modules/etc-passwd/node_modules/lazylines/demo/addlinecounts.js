#!/usr/bin/env node

var util = require("util");
var path = require("path");

var nomnom = require("nomnom");

var ll = require("lazylines");

var scriptName = path.basename(process.argv[1]);

var args = nomnom
    .script(scriptName)
    .options({
        pattern: {
            position: 0,
            required: true,
            help: "The pattern to wrap around each line.\nVariables: {line}, {i}, {padi}."
        },
        pad: {
            abbr: 'p',
            metavar: "DIGITCOUNT",
            "default": 3,
            help: "The number of digits each padded number should have"
        }
    })
    .help(
        "Example:\n" +
        "# List jpg files, oldest first (-t -r), then wrap\n" +
        util.format("ls -1 -t -r *.jpg | %s 'mv \"{line}\" {padi}.jpg' | bash\n", scriptName)
    ).parse();

var pattern = args.pattern;
var padCount = args.pad;

process.stdin.resume();
var inp = new ll.LineReadStream(process.stdin);
var count = 1;
inp.on("line", function (line) {
    line = ll.chomp(line);
    if (line.length === 0) return;
    var vars = {
        line: line,
        i: count,
        padi: lpad(count, padCount)
    };
    console.log(pattern.replace(/{([a-z]+)}/g, function(g0,g1){return vars[g1]}));
    count++;
});

function lpad(value, count, padStr) {
    padStr = padStr || "0";
    value = String(value);
    while(value.length < count) {
        value = padStr+value;
    }
    return value;
}
