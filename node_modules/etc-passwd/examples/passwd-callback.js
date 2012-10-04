#!/usr/bin/env node

var passwd = require('../');

passwd.getUsers(function(users) {
  console.log(JSON.stringify(users));
});
