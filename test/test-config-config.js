var assert = require('assert');
var fs = require('fs');
var path = require('path');
var util = require('util');
var config = require('../lib/config/config');
var schema = require('../lib/config/schema');
var config_router = require('../lib/router/config-router');

var schemaPath = path.join(__dirname, '../lib/router/shiny-server-rules.config');

var configData = config.parse('\
runas nobody;\n\
max_workers 10;\n\
server {\n\
  location / {\n\
    runas jcheng;\n\
    app_dir ~/myshinyapp;\n\
  }\n\
}');

assert.equal(configData.getValue('runas'), 'nobody');
assert.deepEqual(configData.getOne('runas').args, ['nobody']);
assert.equal(configData.getOne('server').getOne('location').getValue('runas'), 'jcheng');
assert.equal(configData.search('location')[0].getValue('runas'), 'jcheng');

var validationRules = config.parse(fs.readFileSync(schemaPath, 'utf8'));
schema.applySchema(configData, validationRules);

var configGood = config.readSync(path.join(__dirname, 'config/good.config'), schemaPath);
assertBad('bad1', schemaPath, /Unknown directive/);
assertBad('bad2', schemaPath, /too few arguments/);
assertBad('bad3', schemaPath, /too many arguments/);
assertBad('good', path.join(__dirname, 'config/schemaBad1.config'), /Missing "at"/);
assertBad('good', path.join(__dirname, 'config/schemaBad2.config'), /Unknown type "Number"/);

function assertBad(file, schemaPath, regex) {
  try {
    config.readSync(path.join(__dirname, 'config', file + '.config'), schemaPath);
    assert(false, file + " passed parse when it should've failed");
  } catch(err) {
    if (!regex.test(err.message))
      throw err;
  }
}

config_router.createRouter_p(path.join(__dirname, 'config/good.config'))
.then(function(router) {
  //console.log(util.inspect(router, false, null, true));
})
.done();