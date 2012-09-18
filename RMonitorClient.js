var util = require('util');

var getpwnam = require('./etcpasswd').getpwnam;

var RMonitorClient = exports.RMonitorClient = function(options){
}

RMonitorClient.prototype.procInfo = function(user,app){
   return null;
}

RMonitorClient.prototype.spawnProc = function(user,app){
   userInfo = getpwnam(user);

   if (!userInfo){
      return {
         status: "nouser"
      };
   }

   return {
      status: "starting"
   };
}
