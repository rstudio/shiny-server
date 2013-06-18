var util = require('util');
var config_lexer = require('../lib/config/lexer');
var config_parser = require('../lib/config/parser');

var TT = config_lexer.TT;
var ConfigParser = config_parser.ConfigParser;

var parser = new ConfigParser("foo#hi\n    bar");

parser.$nextToken().type === TT.WORD;
parser.$nextToken().type === TT.WORD;
parser.$nextToken() === null;

parser = new ConfigParser("foo ~ /hello/\n[L];\nlocation / { bar baz 'wha'; }");
console.log(util.inspect(parser.parse(), false, null, true));
