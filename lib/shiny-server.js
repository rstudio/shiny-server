#!/usr/bin/env node

//
// shiny-server.js
//
// Copyright (C) 2009-12 by RStudio, Inc.
//
// This program is licensed to you under the terms of version 3 of the
// GNU Affero General Public License. This program is distributed WITHOUT
// ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
// AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
//
var util = require('util'),
    net = require('net'),
    http = require('http'),
    fs = require('fs'),
    httpProxy = require('http-proxy'),
    sockjs = require('sockjs'),
    websocket = require('faye-websocket'),
    url = require('url'),
    cjson = require('cjson'),
    Handlebars = require('handlebars'),
    _ = require('underscore'),
    RMonitorClient = require('./RMonitorClient').RMonitorClient,
    rc = require('./ReferenceCounter'),
    MetaHandler = require('./meta-handler').MetaHandler,
    SockJSUtils = require('sockjs/lib/utils');

console.log = util.log;

var ShinyProxy = function(shinyConfig) {
   this.config = shinyConfig;
   this.listenAddr = '0.0.0.0';
   this.listenPort = 80;
   this.sockjsHandlers = new MetaHandler();
   this.server =  http.createServer(this.httpHandler());
   this.proxiedUserApps = {};
   this.rmon = new RMonitorClient(
      {shinyOptions: shinyConfig}
   );

   // Intercept the "request" and "upgrade" events for SockJS. Only if these handlers return
   // false do the other listeners get a crack.
   //
   // Any listeners added after the calls to overshadowListeners, will NOT be overshadowed!
   SockJSUtils.overshadowListeners(this.server, 'request', this.sockjsHandlers.getHandler());
   SockJSUtils.overshadowListeners(this.server, 'upgrade', this.sockjsHandlers.getHandler());
};

function sendPage(response, status, title, options) {
   var config = _.extend({
      contentType: 'text/html; charset=utf-8',
      title: title,
      vars: {},
      headers: {},
      template: 'default'
   }, options);

   var headers = _.extend({
      'Content-Type': config.contentType
   }, config.headers);

   var template = Handlebars.compile(
      fs.readFileSync(__dirname + '/../templates/' + config.template + '.html', 'utf-8'));

   response.writeHead(status, headers);
   response.end(template(_.extend({title: title}, config.vars)));
}

function send404(response) {
   sendPage(response, 404, 'Page not found', {
      vars: {
         message: "Sorry, but the page you requested doesn't exist."
      }
   });
}

// Tease out user and app strings from URLs of the form:
//
//    "^/username/appname(/.*)?$
// 
ShinyProxy.prototype.getAppDetails = function(url){
   var results = /^\/([0-9.\-A-Za-z_]+)\/([0-9.\-A-Za-z_]+)(?:(\/).*)?$/.exec(url);
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

ShinyProxy.prototype.debug = function(){
   var i, j, apps;
   apps = Object.keys(this.proxiedUserApps);
   console.log("DEBUG: LIST OF APPS");
   for (i = 0; i < apps.length; i++){
      console.log(apps[i] + ': ' + 
            this.proxiedUserApps[apps[i]].refdTimeout._count);
      for (j = 0; j < this.proxiedUserApps[apps[i]].clientList.length; j++){
         console.log('   ' + this.proxiedUserApps[apps[i]].clientList[j].wsClient.url);
      }
   }
   console.log("DEBUG: END");
}

ShinyProxy.prototype.httpHandler = function(){
   var self = this;
   var handler = function(req,res){
      var appDetails, newUrl;

      appDetails = self.getAppDetails(req.url);

      console.log('proxy: '+req.url);

      if (req.url === '/' && self.config['homepageRedirect']) {
         res.writeHead(301, {
            'Content-Type': 'text/html',
            'Location': self.config['homepageRedirect']
         });
         res.end('<h1><a href="' + self.config['homepageRedirect'] +
            '">Moved permanently</a></h1>');
      }

      if (req.url === '/ping'){
         res.writeHead(200, {'Content-Type': 'text/plain'});
         res.end("OK");
         return;
      }

      if (req.url === '/debug'){
         res.writeHead(200, {'Content-Type': 'text/html'});
         self.debug();
         res.end("<h2>Debugging output to console</h2>");
         return;
      }

      if (!appDetails){
         send404(res);
         return;
      }

      if (!appDetails.trailingSlash){
         newUrl = '/' + appDetails.user + '/' + appDetails.app + '/';
         sendPage(res, 301, 'Moved permanently', {
            headers: {
               Location: newUrl
            }
         });
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

      // console.log("ws("+appDetails.hash+"): "+sockjsClient.remotePort+"<->"+wsClient._uri.port+" ws open");

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
         // console.log("ws("+appDetails.hash+"): "+sockjsClient.remotePort+"<- "+wsClient._uri.port);
         sockjsClient.write(event.data);
      };

      wsClient.onerror = wsClient.onclose = function(event){
         var msg = ShinyProxyMessageToClient("The RWebSocket unexpectedly closed. Inspect your Shiny app and refresh your browser window.");

         // console.log("ws("+appDetails.hash+"): "+sockjsClient.remotePort+" ->"+wsClient._uri.port+" close");

         sockjsClient.write(msg);
         sockjsClient.close();

         // Do we need to call close here?
         wsClient.close();

         self.removeConnectedClient(sockjsClient,wsClient);
      };

      sockjsClient.on('data', function(message) {
         // console.log("ws("+appDetails.hash+"): "+sockjsClient.remotePort+" ->"+wsClient._uri.port);
         if (wsIsOpen){
            wsClient.send(message);
         } else {
            fmq.push(message);
         }
      });

      sockjsClient.on('close', function(message){
         // console.log("ws("+appDetails.hash+"): "+sockjsClient.remotePort+"<- "+wsClient._uri.port+" close");
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
      try { this._socketToR.close() }
      catch (ex) { /* no-op */ }
      this._socketToR = null;
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
         {prefix: this.appDetails.rootUrl + '/__sockjs__'}).getHandler();

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
      if (this.sockjsHandler && this.sockjsHandler(req,res)) continue;

      // Quick return
      if (this.rShinyProc.status === "nouser"){
         send404(res);
      } else if (this.rShinyProc.status === "dead"){
         if (this.rShinyProc.substatus === "notfound") {
            send404(res);
         }
         else {
            sendPage(res, 500, "Sorry, an error has occurred.", {
               vars: {
                  message: "The application failed to start.",
                  detail: this.rShinyProc.message,
                  console: this.rShinyProc.stderr
               }
            });
         }
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

// Default to a UTF-8 locale if LANG not set
if (process.env.LANG == undefined)
   process.env.LANG = 'en_US.UTF-8';

var shinyConfig = {
   listenPort: 80,
   listenAddr: '0.0.0.0'
};
if (fs.existsSync("/etc/shiny-server/config"))
   _.extend(shinyConfig, cjson.load("/etc/shiny-server/config"));

SHINY = new ShinyProxy(shinyConfig);

SHINY.server.listen(shinyConfig.listenPort, shinyConfig.listenAddr);

// Ctrl-c performs a hopefully graceful shutdown.
//
function shutdown() {
  console.log('Shutting down');
  SHINY.shutdown();
}
process.on('SIGINT', process.exit);
process.on('SIGTERM', process.exit);
process.on('exit', shutdown);
