//
// A naive attempt at an R Monitor client. In this implementation
// the client is actually the monitor (server) as well.
//
var util = require('util');
var cp = require('child_process');

var getpwnam = require(__dirname + '/etcpasswd').getpwnam;

// Need to pass this all the way to R, so make it absolute
process.env.SOCKJSADAPTER='/usr/local/lib/shiny-proxy/SockJSAdapter.R';

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
         process.kill(this.procs[i].pid,'SIGUSR1');
         this.procs.splice(i,1);
      }
   }
   return null;
}
