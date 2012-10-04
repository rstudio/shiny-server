#!/usr/bin/env node

var passwd = require('../');

passwd.getGroup({'groupname': process.argv[2] || 'wheel'}, function(err, group) {
  if (err) throw err;
  console.log(JSON.stringify(group));
});
