var assert = require('assert');
var util = require('util');
var config = require('../lib/config/config');

var configData = config.parseConfigData('\
user nobody;\n\
http {\n\
  location ~ / {\n\
    runas jcheng;\n\
    appdir ~/myshinyapp;\n\
  }\n\
}');

assert.equal(configData.getValue('user'), 'nobody');
assert.deepEqual(configData.getOne('user').args, ['nobody']);
assert.equal(configData.getOne('http').getOne('location').getValue('runas'), 'jcheng');
assert.equal(configData.search('location')[0].getValue('runas'), 'jcheng');
