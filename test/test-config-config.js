var assert = require('assert');
var path = require('path');
var util = require('util');
var config = require('../lib/config/config');

var configData = config.parseConfigData('\
runas nobody;\n\
server {\n\
  location / {\n\
    runas jcheng;\n\
    appdir ~/myshinyapp;\n\
  }\n\
}');

assert.equal(configData.getValue('runas'), 'nobody');
assert.deepEqual(configData.getOne('runas').args, ['nobody']);
assert.equal(configData.getOne('server').getOne('location').getValue('runas'), 'jcheng');
assert.equal(configData.search('location')[0].getValue('runas'), 'jcheng');

var validationRules = config.readSync(path.join(__dirname, '../lib/config/shiny-server-rules.config'));
config.validate(validationRules, configData);