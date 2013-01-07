/*
 * run-as.js
 *
 * Copyright (C) 2009-13 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
// Intended to be launched via child_process.exec. It merely drops
// permissions and runs the given command/args. stdio is passed
// through, and the exit code of the subcommand will also be the
// exit code of this command.
//
// Usage: run-as.js <user> <command> <args>

var unixgroups = require('unixgroups');
var child_process = require('child_process');
var _ = require('underscore');
var posix = require('../../build/Release/posix');
var map = require('../core/map');


// Drop permissions first
var user = process.argv[2];
unixgroups.initgroups(user, true); // also calls setgid
process.setuid(user);


var cmd = process.argv[3];
var args = _.rest(process.argv, 4);

// Change a few env variables to match user's identity
var env = map.create();
var pwd = posix.getpwnam(user);
env.USER = user;
env.LOGNAME = user;
env.HOME = pwd.home;
env.SHELL = pwd.shell;

env.SHINY_PORT = process.env.SHINY_PORT;
env.SHINY_APP = process.env.SHINY_APP;
env.SHINY_GAID = process.env.SHINY_GAID;
env.SOCKJSADAPTER = process.env.SOCKJSADAPTER;

var proc = child_process.spawn(cmd, args, {
  stdio: 'inherit',
  env: env
});

proc.on('exit', function(code) {
  process.exit(code);
});
