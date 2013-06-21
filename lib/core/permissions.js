/*
 * permissions.js
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
var posix = require('../../build/Release/posix');

exports.isSuperuser = isSuperuser;
/**
 * Return true if the user is root
 */
function isSuperuser() {
  return process.getuid() == 0;
}

var processUser = {};
exports.getProcessUser = getProcessUser;
function getProcessUser() {
  var uid = process.getuid();
  if (!processUser.name || processUser.uid !== uid) {
    processUser = {
      uid: uid,
      name: (posix.getpwuid(uid) || {}).name
    }
  }
  return processUser.name;
}

exports.canRunAs = canRunAs;
function canRunAs(user) {
  return isSuperuser() || user === getProcessUser();
}