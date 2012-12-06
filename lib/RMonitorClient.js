//
// RMonitorClient.js
//
// Copyright (C) 2009-12 by RStudio, Inc.
//
// This program is licensed to you under the terms of version 3 of the
// GNU Affero General Public License. This program is distributed WITHOUT
// ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
// AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
//


// A naive attempt at an R Monitor client. In this implementation
// the client is actually the monitor (server) as well.
//
var util = require('util');
var cp = require('child_process');

var getpwnam = require(__dirname + '/etcpasswd').getpwnam;

// Need to pass this all the way to R, so make it absolute
process.env.SOCKJSADAPTER=__dirname + '/../R/SockJSAdapter.R';

var RMonitorClient = exports.RMonitorClient = function(options){
   this.options = options;
   this.procs = [];
}

RMonitorClient.prototype.newProc = function(options){
   var proc = {
         status: 'new',
         user: null,
         app: null,
         pid: null,
         port: null,
         host: 'localhost',
         retries: 0,
         launcher: null
   };
   var i;
   if (options){
      for (i in proc){
         if (options.hasOwnProperty(i)) proc[i] = options[i];
      }
   }

   return proc;
}

RMonitorClient.prototype.procInfo = function(user,app){
   var i;

   for (i = 0; i < this.procs.length; i += 1){
      if (this.procs[i].user === user && this.procs[i].app == app)
         return this.procs[i];
   }
   return null;
}

// Start a new user+app. Ensure one proc per user+app
RMonitorClient.prototype.startProc = function(user,app){
   var child, proc, self;
   var userInfo = getpwnam(user);

   self = this;


   // Get out of here as fast as possible
   if (!userInfo)
      return this.newProc({ status: "nouser" });

   proc = this.procInfo(user,app);

   if (proc && (proc.status === "running" || proc.status == "dead"))
      return proc;

   if (!proc){
      proc = this.newProc({user: user, app: app});
      this.procs.push(proc);
   }

   if (proc.status === "new")
      proc.status = "starting";
  
   if (proc.retries < 3){
      proc.retries += 1;

      if (!proc.launcher){
         proc.launcher = cp.fork(__dirname + '/RMonitor.js');

         proc.launcher.on('exit',function(code,signal){
            if (code === 1){
               // launcher is bad
               proc.status = "dead";
            }
         });

         proc.launcher.on('message', function(m) {
            message = {user: proc.user, app: proc.app, options: self.options};
            if (m.status === 'ready'){
               // Send user and app name
               proc.launcher.send(message);
            } else if (m.status === "started"){
               proc.port = m.port;
               proc.status = "running";
               proc.pid = m.pid;
               proc.launcher = null;
            } else if (m.status === "aborting"){
               console.log("RMonitorClient: RMonitor abort: "+m.message);
               proc.status = "dead";
               proc.substatus = m.substatus;
               proc.message = m.message;
               proc.stderr = m.stderr;
               proc.launcher = null;
            }
         });
      }

   } else {
      proc.status = 'unknown';
   }

   return proc;
}

RMonitorClient.prototype.stopProc = function(user, app){
   var i;

   for (i = 0; i < this.procs.length; i += 1){
      if (this.procs[i].user === user && this.procs[i].app == app){
         if (this.procs[i].status != "dead") {
            try {
               (function() {
                  var pid = this.procs[i].pid;
                  console.log('[stopProc] Sending SIGINT to ' + pid);
                  process.kill(pid, 'SIGINT');
                  setTimeout(function() {
                     // Check if still alive
                     cp.exec('ps h -p ' + pid + ' | wc -l', function(error, stdout, stderr) {
                        if (parseInt(stdout) != 0) {
                           console.log('[stopProc] Process ' + pid + ' did not die, sending SIGTERM');
                           try {
                              process.kill(pid, 'SIGTERM');
                           }
                           catch (ex) {
                              console.log('[stopProc] Failed to send SIGTERM to process ' + pid);
                           }
                        }
                        else {
                           console.log('[stopProc] Process ' + pid + ' went peacefully');
                        }
                     })
                  }, 30000);
               }).call(this);
            }
            catch (ex) {
               console.log('[stopProc] Failed to send SIGINT to process ' + this.procs[i].pid + ': ' + ex);
            }
         }
         else {
            console.log('[stopProc] Not killing ' + this.procs[i].pid + ', it is already dead');
         }
         this.procs.splice(i,1);
      }
   }
   return null;
}
