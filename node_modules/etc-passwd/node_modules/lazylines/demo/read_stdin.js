#!/usr/bin/env node

// Example invocation (adds numbers to lines that are typed interactively):
// cat | ./read_stdin.js

var ll = require("../lazylines.js");

process.stdin.resume();
var inp = new ll.LineReadStream(process.stdin);
var count = 1;
inp.on("line", function (line) {
    console.log(count+": "+ll.chomp(line));
    count++;
});
