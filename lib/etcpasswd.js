//
// etcpasswd.js
//
// Copyright (C) 2009-12 by RStudio, Inc.
//
// This program is licensed to you under the terms of version 3 of the
// GNU Affero General Public License. This program is distributed WITHOUT
// ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
// AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
//
var fs = require('fs');
var util = require('util');

module.exports.getpwnam = function(name){
   var i;
   var users = fs.readFileSync('/etc/passwd','utf8').split('\n');
   var users_split;
   
   for( i = 0; i < users.length; i +=1 ){
      users_split = users[i].split(':');
      if (users_split[0] === name){
        return {
          'username': users_split[0],
          'password': users_split[1],
          'uid': +users_split[2],
          'gid': +users_split[3],
          'comments': users_split[4],
          'home': users_split[5],
          'shell': users_split[6]
        };
      }
   }

   return null;
}
