// 
// shiny-proxy-2.js: A shiny proxy server using sockjs
//
// [browser] <-----sockjs-----> [shiny-proxy] <----websockets----> [shiny apps]
// 
// Call like:
//
// node shiny-proxy-2.js
//
var util = require('util'),
    http = require('http'),
    httpProxy = require('http-proxy'),
    sockjs = require('sockjs'),
    websocket = require('faye-websocket'),
    url = require('url'),
    RMonitorClient = require('./RMonitorClient').RMonitorClient,
    rc = require('./ReferenceCounter'),
    MetaHandler = require('./meta-handler').MetaHandler,
    SockJSUtils = require('sockjs/lib/utils');

var ShinyProxy = function() {
   this.listenAddr = '0.0.0.0';
   this.listenPort = 8000;
   this.sockjsPrefix = '/sockjs';
   this.sockjsHandlers = new MetaHandler();
   this.proxy =  null;
   this.proxiedUserApps = {};
   this.rmon = null;
};

ShinyProxy.prototype.getUserAppFromUrl = function(url,prefix){
   var results;

   if (prefix)
      url = url.replace(prefix,'')
  
   results = /^\/([0-9.\-A-Za-z_]+)\/([0-9.\-A-Za-z_]+)(?:(\/).*)?$/.exec(url);

   
   if (!results) return null;

   return {
      user: results[1],
      app: results[2],
      hash: results[1]+'-'+results[2],
      rootUrl: '/' + results[1] + '/' + results[2],
      trailingSlash: (results[3] != undefined)? true : false
   };
}

ShinyProxy.prototype.userAppIsProxied = function(userAppHash){
   return (this.proxiedUserApps[userAppHash] !== undefined);
}

ShinyProxy.prototype.proxyUserApp = function(userAppHash,rShinyProc){
   var self = this;
   if (this.proxiedUserApps[userAppHash] === undefined){
      this.proxiedUserApps[userAppHash] = {
         app: rShinyProc,
         sockjsServer: null,
         refdTimeout: rc.createRefCounter(
               function(){
                  self.unProxyUserApp(userAppHash);
               },
               10000
         ).start(),
         clientList: []
      };
   }
}

ShinyProxy.prototype.unProxyUserApp = function(userAppHash){
   console.log('Tearing down ' + userAppHash);
   var userApp, clientList, i;

   console.log('unProxyUserApp('+userAppHash+')');
   if (!this.userAppIsProxied(userAppHash)) return;

   userApp = this.proxiedUserApps[userAppHash];

   // Close all connected clients.
   clientList = userApp.clientList;
   if (clientList.length > 0){
      for (i = 0; i < clientList.length; i+=1){

         // TODO: Notify the client of shutdown.
         // clientList[i].sockjsClient.write(new ShutdownNotification());
         clientList[i].sockjsClient.close();
         clientList[i].wsClient.close();
      }
   }

   // Extricate this sockjs server from the proxy.
   if (userApp.dispose)
      userApp.dispose();

   // Kill R process.
   this.rmon.stopProc(userApp.app.user,userApp.app.app);

   delete this.proxiedUserApps[userAppHash];

}

ShinyProxy.prototype.shutdown = function(){
   var userApps = Object.keys(this.proxiedUserApps);
   for (userApp in userApps){
      this.unProxyUserApp(userApp);
   }
}

ShinyProxy.prototype.sockjsServerEstablished = function(userAppHash){
   if (this.userAppIsProxied(userAppHash)){
      return (this.proxiedUserApps[userAppHash] === null)
   }
   return false;
}

ShinyProxy.prototype.addUserAppSockjsServer = function(userAppHash,dispose){
   if (this.userAppIsProxied(userAppHash)){
      // Ensure that the R user app stays around long enough for the client
      // to come back and establish a sockjs connection. This turns into a no-op
      // if the reference count on refdTimeout is > 0.
      this.proxiedUserApps[userAppHash].refdTimeout.delayTimeoutBy(5000);

      // Cleanup function to be called when sockjs server is shut down
      this.proxiedUserApps[userAppHash].dispose = dispose;
   }
}


ShinyProxy.prototype.addConnectedClient = function(userAppHash,sockjsClient,wsClient){
   var clientList;

   if (!this.userAppIsProxied(userAppHash)) return;

   this.proxiedUserApps[userAppHash].refdTimeout.increment();

   this.proxiedUserApps[userAppHash].clientList.push({
      sockjsClient: sockjsClient, 
      wsClient: wsClient
   });
}

ShinyProxy.prototype.removeConnectedClient = function(userAppHash,sockjsClient,wsClient){
   var i, clientList;

   if (!this.userAppIsProxied(userAppHash)) return;

   clientList = this.proxiedUserApps[userAppHash].clientList;

   for (i = 0; i < clientList.length; i++){
      if (clientList[i].sockjsClient === sockjsClient &&
          clientList[i].wsClient === wsClient){
         clientList.splice(i,1);
         this.proxiedUserApps[userAppHash].refdTimeout.decrement();
      }
   }

}

SHINY = new ShinyProxy();

SHINY.rmon = new RMonitorClient(
      {shinyOptions: {sockjsPrefix: SHINY.sockjsPrefix}}
);

// Ctrl-c performs a hopefully graceful shutdown.
//
process.on('SIGINT',function(){
  SHINY.shutdown();
  process.exit();
});

var sockjsProxyHandler = function(rShinyProc){
   var handler = function(sockjsClient) {
      var fmq, wsIsOpen, wsClient, userApp, userAppHash;

      userAppHash = rShinyProc.user+'-'+rShinyProc.app;

      // Forwarding Message Queue
      fmq = [];

      wsIsOpen = false;


      if (!rShinyProc) sockjsClient.close();

      wsClient = new websocket.Client('ws://'+rShinyProc.host+':'+rShinyProc.port+'/'); 

      SHINY.addConnectedClient(userAppHash,sockjsClient,wsClient);

      console.log("ws("+userAppHash+"): "+sockjsClient.remotePort+"<->"+wsClient._uri.port+" ws open");

      wsClient.onopen = function(event){
         wsIsOpen = true;
         var i;


         if (fmq.length){
            for (i = 0; i < fmq.length; i++){
               wsClient.send(fmq[i]);
            }
            fmq = [];
         }
      }

      wsClient.onmessage = function(event){
         console.log("ws("+userAppHash+"): "+sockjsClient.remotePort+"<- "+wsClient._uri.port);
         sockjsClient.write(event.data);
      };

      wsClient.onclose = function(event){
         console.log("ws("+userAppHash+"): "+sockjsClient.remotePort+" ->"+wsClient._uri.port+" close");
         sockjsClient.close();

         // Do we need to call close here?
         wsClient.close();

         SHINY.removeConnectedClient(userAppHash,sockjsClient,wsClient);
      };

      sockjsClient.on('data', function(message) {
         console.log("ws("+userAppHash+"): "+sockjsClient.remotePort+" ->"+wsClient._uri.port);
         if (wsIsOpen){
            wsClient.send(message);
         } else {
            fmq.push(message);
         }
      });

      sockjsClient.on('close', function(message){
         console.log("ws("+userAppHash+"): "+sockjsClient.remotePort+"<- "+wsClient._uri.port+" close");
         wsClient.close();

         // Do we need to call close here?
         sockjsClient.close();

         SHINY.removeConnectedClient(userAppHash,sockjsClient,wsClient);
      });
   }
   return handler;
}

SHINY.proxy = httpProxy.createServer(function(req,res,proxy){
   var sockjsServer, rShinyProc, listener, disposeListener;
   var userApp = SHINY.getUserAppFromUrl(req.url);

   console.log('proxy: '+req.url);

   if (req.url === '/debug'){
      res.writeHead(200, {'Content-Type': 'text/html'});
      console.log(SHINY.proxiedUserApps);
      res.end("<h2>Debugging output to console</h2>");
      return;
   }

   if (!userApp){
      res.writeHead(404, {'Content-Type': 'text/html'});
      res.end('<h1>Not found</h1>');
      return;
   }

   if (!userApp.trailingSlash){
      newUrl = '/' + userApp.user + '/' + userApp.app + '/';
      res.writeHead(301, {
         'Content-Type': 'text/html', 
         'Location': newUrl
      });
      res.end('<h1><a href="'+newUrl+'">Moved Permanently</a></h1>');
      return;
   }

   rShinyProc = SHINY.rmon.procInfo(userApp.user,userApp.app);

   if (!rShinyProc){
      rShinyProc = SHINY.rmon.startProc(userApp.user,userApp.app);
      SHINY.proxyUserApp(userApp.hash,rShinyProc);
   }

   if (rShinyProc.status === "starting"){
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write('<html><head><meta http-equiv="refresh" content="3"></head>');
      res.end("<body><h1>Creating App. Just a Sec...</h1></body></html>");
   } else if (rShinyProc.status === "nouser"){
      res.writeHead(400, {'Content-Type': 'text/html'});
      res.end('<h1>User '+userApp.user+' Does Not Exist!</h1>');
   } else if (rShinyProc.status === "dead"){
      res.writeHead(500, {'Content-Type': 'text/html'});
      res.end('<h1>Internal Error! Cannot start '+userApp.hash+'!</h1>');
   } else if (rShinyProc.status === "running"){
      req.url = req.url.replace(userApp.rootUrl,'')
      proxy.proxyRequest(req,res,{
         host: rShinyProc.host,
         port: rShinyProc.port
      });
      if (!SHINY.sockjsServerEstablished(userApp.hash)){

         sockjsServer = sockjs.createServer();
         sockjsServer.on('connection', sockjsProxyHandler(rShinyProc));

         // Create a listener and add it to the metahandler.
         listener = sockjsServer.listener({prefix: SHINY.sockjsPrefix+userApp.rootUrl}).getHandler();
         disposeListener = SHINY.sockjsHandlers.push(listener);

         SHINY.addUserAppSockjsServer(userApp.hash,disposeListener);

      }
   } else {
      res.writeHead(500, {'Content-Type': 'text/html'});
      res.end('<h1>Internal Error! End of rope!</h1>');
   }
});

// Intercept the "request" and "upgrade" events for SockJS. Only if these handlers return
// false do the other listeners get a crack.
//
// Any listeners added after the calls to overshadowListeners, will NOT be overshadowed!
SockJSUtils.overshadowListeners(SHINY.proxy, 'request', SHINY.sockjsHandlers.getHandler());
SockJSUtils.overshadowListeners(SHINY.proxy, 'upgrade', SHINY.sockjsHandlers.getHandler());

SHINY.proxy.listen(SHINY.listenPort,SHINY.listenAddr);
