#!/usr/bin/env node

var passwd = require('../'),
    groups = passwd.getGroups();

groups.on('group', function(group) {
  console.log(JSON.stringify(group));
});

groups.on('end', function() {
  console.log('Done.');
});
