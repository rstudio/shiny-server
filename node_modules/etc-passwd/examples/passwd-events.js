#!/usr/bin/env node

var passwd = require('../'),
    users = passwd.getUsers();

users.on('user', function(user) {
  console.log(JSON.stringify(user));
});

users.on('end', function() {
  console.log('Done.');
});
