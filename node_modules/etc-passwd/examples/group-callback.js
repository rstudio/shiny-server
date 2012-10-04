#!/usr/bin/env node

var passwd = require('../');

passwd.getGroups(function(groups) {
  console.log(JSON.stringify(groups));
});
