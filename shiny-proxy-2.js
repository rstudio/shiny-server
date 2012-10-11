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
    net = require('net'),
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
   this.listenPort = 80;
   this.sockjsPrefix = '/sockjs'; // no trailing slash please
   this.sockjsHandlers = new MetaHandler();
   this.server =  http.createServer(this.httpHandler());
   this.proxiedUserApps = {};
   this.rmon = new RMonitorClient(
      {shinyOptions: {sockjsPrefix: this.sockjsPrefix}}
   );

   // Intercept the "request" and "upgrade" events for SockJS. Only if these handlers return
   // false do the other listeners get a crack.
   //
   // Any listeners added after the calls to overshadowListeners, will NOT be overshadowed!
   SockJSUtils.overshadowListeners(this.server, 'request', this.sockjsHandlers.getHandler());
   SockJSUtils.overshadowListeners(this.server, 'upgrade', this.sockjsHandlers.getHandler());
};

// Tease out user and app strings from URLs of the form:
//
//    "^prefix?/username/appname(/.*)?$
// 
ShinyProxy.prototype.getAppDetails = function(url,prefix){
   var results, prefixReg;

   if (prefix){
      prefixReg = new RegExp('^' + prefix);
      if (url.match(prefixReg))
         url = url.replace(prefixReg,'');
   }
  
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

// always returns the user-app hash
ShinyProxy.prototype.normalizeUserAppDetails = function(appDetails){
   var userAppHash;

   switch (typeof appDetails){
      case 'string': userAppHash = appDetails; break;
      case 'object': userAppHash = appDetails.hash; break;
   }

   return userAppHash;
}

ShinyProxy.prototype.userAppIsProxied = function(appDetails){
   var userAppHash = this.normalizeUserAppDetails(appDetails);

   return (this.proxiedUserApps[userAppHash] !== undefined);
}

ShinyProxy.prototype.proxyUserApp = function(appDetails){
   var proxiedApp;
   if (this.proxiedUserApps[appDetails.hash] === undefined){
      proxiedApp = new ProxiedUserApp(appDetails,this);
      this.proxiedUserApps[appDetails.hash] = proxiedApp;
   }
   return proxiedApp;
}

ShinyProxy.prototype.unProxyUserApp = function(appDetails){
   var userAppHash = this.normalizeUserAppDetails(appDetails);

   console.log('unProxyUserApp('+userAppHash+')');

   if (!this.userAppIsProxied(userAppHash)) return;

   this.proxiedUserApps[userAppHash].unProxy();

   delete this.proxiedUserApps[userAppHash];
}

ShinyProxy.prototype.getProxiedApp = function(appDetails,options){
   var proxiedApp;

   if (this.userAppIsProxied(appDetails)){
      return this.proxiedUserApps[appDetails.hash];
   }
   if (options && options.start === true){
      return this.proxyUserApp(appDetails);
   }

   return null;
}

ShinyProxy.prototype.shutdown = function(){
   var i, apps = Object.keys(this.proxiedUserApps);
   this.shutdownMessage = ShinyProxyMessageToClient(
         "The Sever has been stopped and will be re-started momentarily. " +
         "Refresh your browser window to re-start your application."
   );
   for (i = 0; i < apps.length; i++){
      this.unProxyUserApp(apps[i]);
   }
}

ShinyProxy.prototype.httpHandler = function(){
   var self = this;
   var handler = function(req,res){
      var appDetails, newUrl;

      appDetails = self.getAppDetails(req.url,self.sockjsPrefix);

      console.log('proxy: '+req.url);

      if (req.url === '/debug'){
         res.writeHead(200, {'Content-Type': 'text/html'});
         console.log(self.proxiedUserApps);
         res.end("<h2>Debugging output to console</h2>");
         return;
      }

      if (!appDetails){
         res.writeHead(404, {'Content-Type': 'text/html'});
         res.end('<h1>Not found</h1>');
         return;
      }

      if (!appDetails.trailingSlash){
         newUrl = '/' + appDetails.user + '/' + appDetails.app + '/';
         res.writeHead(301, {
            'Content-Type': 'text/html', 
            'Location': newUrl
         });
         res.end('<h1><a href="'+newUrl+'">Moved Permanently</a></h1>');
         return;
      }

      self.getProxiedApp(appDetails,{start: true}).handleRequest(req,res);

   };

   return handler;
}

var ShinyProxyMessageToClient = function(msg){
   return JSON.stringify({
      custom: msg,
      console: [msg]
   });
}

var ProxiedUserApp = function(appDetails,sProxy){

   this.appDetails = appDetails;
   this.sProxy = sProxy; // Shiny Proxy object
   this.proxy = null; // our own HttpProxy. Set in finishStartup()

   // List of connected clients. We use a reference counter
   // that tracks with the number of clients. When there are no
   // clients, then we unproxy the app.
   this.clientList = [];
   this.refdTimeout = rc.createRefCounter(
         function(){
            sProxy.unProxyUserApp(appDetails);
         },
         5000
   ).start();

   this.rShinyProc = sProxy.rmon.startProc(appDetails.user,appDetails.app);

   // Sockjs handler stuff. Set in finishStartup()
   this.sockjsHandler = null;
   this.disposeOfSockjs = null;

   // Request Queue
   this.requestQueue = [];

   // Interval properties associated with monitoring Rproc startup
   this.startupCallbackId = null;
   this.startupDelay = 500; // interval delay
   this.startupMaxDelay = 10000 // Max amount of time to wait.
   this.startupDelaySum = 0;
   this._socketToR = null;

};

ProxiedUserApp.prototype.addConnectedClient = function(sockjsClient,wsClient){

   this.refdTimeout.increment();

   this.clientList.push({
      sockjsClient: sockjsClient, 
      wsClient: wsClient
   });
}

ProxiedUserApp.prototype.removeConnectedClient = function(sockjsClient,wsClient){
   var i;

   for (i = 0; i < this.clientList.length; i++){
      if (this.clientList[i].sockjsClient === sockjsClient &&
          this.clientList[i].wsClient === wsClient){
         this.clientList.splice(i,1);
         this.refdTimeout.decrement();
      }
   }
}

ProxiedUserApp.prototype.unProxy = function(){
   var i;
   // Close all connected clients.
   if (this.clientList.length > 0){
      for (i = 0; i < this.clientList.length; i+=1){

         if (this.sProxy.shutdownMessage){
            this.clientList[i].sockjsClient.write(
                  this.sProxy.shutdownMessage
            );
         }
         this.clientList[i].sockjsClient.close();
         this.clientList[i].wsClient.close();
      }
   }

   // Extricate the sockjs server from the proxy.
   if (this.disposeOfSockjs)
      this.disposeOfSockjs();

   // Kill R process.
   this.sProxy.rmon.stopProc(this.appDetails.user,this.appDetails.app);
}

ProxiedUserApp.prototype.sockjsOnConnectHandlerProxyMessage = function(msg){
   var handler = function(sockjsClient){
      sockjsClient.write(msg);
      sockjsClient.close();
   }
   return handler;
}

ProxiedUserApp.prototype.sockjsOnConnectHandler = function(){
   var self = this;
   var handler = function(sockjsClient) {
      var fmq, wsIsOpen, wsClient;
      var appDetails = self.appDetails;
      var rShinyProc = self.rShinyProc;

      // Forwarding Message Queue
      fmq = [];

      wsIsOpen = false;

      if (!rShinyProc) sockjsClient.close();

      wsClient = new websocket.Client('ws://'+rShinyProc.host+':'+rShinyProc.port+'/'); 

      self.addConnectedClient(sockjsClient,wsClient);

      console.log("ws("+appDetails.hash+"): "+sockjsClient.remotePort+"<->"+wsClient._uri.port+" ws open");

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
         console.log("ws("+appDetails.hash+"): "+sockjsClient.remotePort+"<- "+wsClient._uri.port);
         sockjsClient.write(event.data);
      };

      wsClient.onclose = function(event){
         var msg = ShinyProxyMessageToClient("The RWebSocket unexpectedly closed. Inspect your Shiny app and refresh your browser window.");

         console.log("ws("+appDetails.hash+"): "+sockjsClient.remotePort+" ->"+wsClient._uri.port+" close");

         sockjsClient.write(msg);
         sockjsClient.close();

         // Do we need to call close here?
         wsClient.close();

         self.removeConnectedClient(sockjsClient,wsClient);
      };

      sockjsClient.on('data', function(message) {
         console.log("ws("+appDetails.hash+"): "+sockjsClient.remotePort+" ->"+wsClient._uri.port);
         if (wsIsOpen){
            wsClient.send(message);
         } else {
            fmq.push(message);
         }
      });

      sockjsClient.on('close', function(message){
         console.log("ws("+appDetails.hash+"): "+sockjsClient.remotePort+"<- "+wsClient._uri.port+" close");
         wsClient.close();

         // Do we need to call close here?
         sockjsClient.close();

         self.removeConnectedClient(sockjsClient,wsClient);
      });
   }
   return handler;
}

ProxiedUserApp.prototype.handleRequest = function(req,res){

   this.requestQueue.push({req:req, res:res, buffer: httpProxy.buffer(req)});

   if (this.startingUp()){
      // Already monitoring startup so nothing to do
      return;
   } else if (this.readyToStart()){
      // Set up the interval to monitor R startup
      this.start();
   } else {
      this.processRequestQueue();
   }

}

ProxiedUserApp.prototype.startingUp = function(){
   return (this.startupCallbackId != null);
}

ProxiedUserApp.prototype.readyToStart = function(){
   return (this.rShinyProc.status === "starting")
}

ProxiedUserApp.prototype.start = function(){
   this.setStartupCallback();
}

ProxiedUserApp.prototype.clearStartupCallback = function(){
   clearInterval(this.startupCallbackId);
   this.startupCallbackId = null;

   if (this._socketToR){
      try { this.socketToR.close() }
      catch (ex) { /* no-op */ }
      this.socketToR = null;
   }
}

ProxiedUserApp.prototype.setStartupCallback = function(){
   var self = this;

   self.startupDelaySum = 0;

   console.log('interval start');
   self.startupCallbackId = setInterval(
      function(){
         var rProcStatus = self.rShinyProc.status;

         self.startupDelaySum += self.startupDelay;

         if (rProcStatus === "running"){
            // Try to connect to it.
            if (!self._socketToR){
               self._socketToR = net.createConnection(
                  {host: self.rShinyProc.host, port: self.rShinyProc.port},
                  function(con){ 
                     self.finishStartup({status: "success"});
                     self.processRequestQueue(); 
                  }
               );
               self._socketToR.on('error',function(err){
                  console.log('_socketToR: '+err);
                  self._socketToR = null;
               });
            }
            return;
         }

         // Waited around long enough or the R process failed to start.
         // Need to process queue and move on.
         if (rProcStatus != "starting" || self.startupDelaySum > self.startupMaxDelay){
            self.finishStartup({status: "failure"});
            self.processRequestQueue();
            return;
         }

      },
      self.startupDelay
   );
}

ProxiedUserApp.prototype.finishStartup = function(options){
   var sockjsServer, msg;

   this.clearStartupCallback();

   sockjsServer = sockjs.createServer();
   this.sockjsHandler = sockjsServer.listener(
         {prefix: this.sProxy.sockjsPrefix+this.appDetails.rootUrl}).getHandler();

   // metahandlers return a function when an object is pushed onto
   // the array. It disposes of the object.
   this.disposeOfSockjs = this.sProxy.sockjsHandlers.push(this.sockjsHandler);

   if (options.status === "success"){
      sockjsServer.on('connection', this.sockjsOnConnectHandler());

      this.proxy = new httpProxy.HttpProxy({target: 
         {host: this.rShinyProc.host, port: this.rShinyProc.port}});

      this.proxy.on('proxyError',function(err,req,res){
         console.log('proxyError:'+err);
         res.writeHead(500, {'Content-Type': 'text/html'});
         res.end('<h1>Internal Proxy Error!!'+err+'</h1>');
      });

   } else {
      msg = ShinyProxyMessageToClient("Shiny Application Failed To Start!\nInspect it and then refresh your browser window.\n");
      sockjsServer.on('connection', this.sockjsOnConnectHandlerProxyMessage(msg));

      this.proxy = null;

   }
}

ProxiedUserApp.prototype.processRequestQueue = function(){
   var r, i, req, res, reqBuffer;


   if (this.requestQueue.length <= 0) return;

   for (i = 0; i < this.requestQueue.length; i++){
      req = this.requestQueue[i].req;
      res = this.requestQueue[i].res;
      reqBuffer = this.requestQueue[i].buffer;

      // Give sockjs one more chance to handle request
      if (this.sockjsHandler(req,res)) continue;

      // Quick return
      if (this.rShinyProc.status === "nouser"){
         res.writeHead(400, {'Content-Type': 'text/html'});
         res.end('<h1>User '+this.appDetails.user+' Does Not Exist!</h1>');
      } else if (this.rShinyProc.status === "dead"){
         res.writeHead(500, {'Content-Type': 'text/html'});
         res.end('<h1>Internal Error! Cannot start '+this.appDetails.hash+'!</h1>');
      } else if (this.rShinyProc.status === "nouser"){
         res.writeHead(400, {'Content-Type': 'text/html'});
         res.end('<h1>User '+this.appDetails.user+' Does Not Exist!</h1>');
      } else if (this.rShinyProc.status === "dead"){
         res.writeHead(500, {'Content-Type': 'text/html'});
         res.end('<h1>Internal Error! Cannot start '+this.appDetails.hash+'!</h1>');
      } else if (this.rShinyProc.status === "running"){

         req.url = req.url.replace(this.appDetails.rootUrl,'')

         console.log('proxyto('+this.rShinyProc.host+':'+this.rShinyProc.port+'): '+req.url);

         // Do our best to prevent caching of any web assets.
         //res.setHeader('Cache-Control','no-cache');
         //res.setHeader('Pragma','no-cache');
         //res.setHeader('Expires','Sat, 01 Jan 2000 00:00:00 GMT');

         this.proxy.proxyRequest(req,res,reqBuffer);

      } else {
         res.writeHead(500, {'Content-Type': 'text/html'});
         res.end('<h1>Internal Error! End of rope!</h1>');
      }
   }
   this.requestQueue = [];
}

SHINY = new ShinyProxy();

SHINY.server.listen(SHINY.listenPort,SHINY.listenAddr);

// Ctrl-c performs a hopefully graceful shutdown.
//
process.on('SIGINT',function(){
  SHINY.shutdown();
  process.exit();
});
