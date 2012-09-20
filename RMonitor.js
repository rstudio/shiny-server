var net = require('net');
var cp = require('child_process');
var getpwnam = require('./etcpasswd').getpwnam;
var SOCKJSADAPTER='/home/hornerj/NODE/shiny-playground/SockJSAdapter.R';
var RPROG='/home/hornerj/R-sources/trunk/bin/R';

//

// Return a random port between 49152 and 65535.
//
// Stevens calls this the dynamic or private port range.
//
var randomPort = function(){
   return Math.floor((Math.random()*16384+49152))
}

var abort = function(){
   process.send({status: "aborting"});
   process.exit();
}

process.send({status: 'ready'});

process.on('message',function(m){
   var i, spawnR, server, port;
   var userInfo = getpwnam(m.user);

   console.log('got message');
   console.log(m);

   if (!userInfo){
      abort();
   }

   try {
      process.setuid(userInfo.username);
   } catch (err){
      abort();
   }

   try {
      process.chdir(userInfo.home + '/ShinyApps');
   } catch (err){
      abort();
   }

   spawnR = function() {
      var env = process.env;

      env.SHINY_PORT=port;
      env.SHINY_APP=m.app;

      var R = cp.spawn(RPROG,['--slave','-f',SOCKJSADAPTER],{env: env, detach: true});
      message = {
         status: "started",
         port: port,
         pid: R.pid
      };
      process.send(message);
      R.stderr.setEncoding('utf8');
      R.stdout.setEncoding('utf8');

      R.on('exit',function(code,signal){
         abort();
      });

      R.stderr.on('data', function(m){
        if (/^execvp\(\)/.test(m)) {
           abort();
         } else {
            console.log('R stderr: '+m);
         }
      });

      R.stdout.on('data',function(m){
         console.log('R stdout: '+m);
      });
   }

   // Bind to a random port first, then spawnR();
   i = 1;
   port = randomPort();
   server = net.createServer();
   server.listen(port,'localhost',function(){
      server.close();
      spawnR();
   });

   server.on('error', function (e) {
      if (e.code == 'EADDRINUSE') {
         i += 1;
         if (i > 5) abort();
         port = randomPort();
         server.listen(port, 'localhost');
      }
   });
});
