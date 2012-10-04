#!/usr/bin/env node

var ll = require("../lazylines.js");
var fs = require("fs");

var fileName = process.argv[2];
var inp = ll.LineReadStream.fromFile(fileName);
var count = 1;
inp.on("line", function (line) {
    console.log(count+": "+ll.chomp(line));
    count++;
});
