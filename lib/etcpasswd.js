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
