#!/usr/bin/env node

var passwd = require('../');

passwd.getUser({'username': process.argv[2] || 'root'}, function(err, user) {
  if (err) throw err;
  console.log(JSON.stringify(user));
});
