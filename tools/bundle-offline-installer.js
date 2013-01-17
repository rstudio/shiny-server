#!/usr/bin/env node

/*
 * bundle-offline-installer.js
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

var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

var packageJson = path.join(__dirname, '../package.json');
var packageJsonContents = fs.readFileSync(packageJson, 'utf-8')
var package = JSON.parse(packageJsonContents);
var deps = package.dependencies;
var depnames = [];
for (dep in deps) {
  if (deps.hasOwnProperty(dep))
    depnames.push(dep);
}

package.bundledDependencies = depnames;

var contents = JSON.stringify(package, null, '  ');

fs.writeFileSync(packageJson, contents, 'utf-8');
function restoreContents() {
  fs.writeFileSync(packageJson, packageJsonContents, 'utf-8');
}
process.on('exit', function() {
  restoreContents();
});
process.on('uncaughtException', function(err) {
  restoreContents();
  console.log('ERROR: ' + err.message);
  process.exit(1);
});

var cp = child_process.spawn(
  'sh',
  ['-c', 'npm install && echo Building package... && npm pack'],
  {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  }
);

cp.on('exit', function(code) {
  if (code) {
    process.stderr.write('Bundling failed!\n');
    process.exit(code);
  } else {
    var filename = 'shiny-server-' + package.version + '.tgz';

    console.log('\n');
    console.log('Your package has been built. To install, call this command as root or sudo:');
    console.log('  npm install --no-registry -g ' + filename);
    console.log('\n');
  }
});