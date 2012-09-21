// 
// shiny-proxy-2.js: A shiny proxy server using sockjs
//
// [browser] <-----sockjs-----> [shiny-proxy] <----websockets----> [shiny apps]
// 
// Call like:
//
// node shiny-proxy-2.js
//
// And edit the below SHINY object
//
var util = require('util'),
    http = require('http'),
    httpProxy = require('http-proxy'),
    sockjs = require('sockjs'),
    websocket = require('faye-websocket'),
    url = require('url'),
    RMonitorClient = require('./RMonitorClient').RMonitorClient;

SHINY = {
   listen_addr: '0.0.0.0',
   listen_port: 8000,
   sockjs_prefix: '/sockjs',
   proxy: null,
   proxied_apps: [],
   rmon: null
};

SHINY.rmon = new RMonitorClient(
      {shiny_options: {sockjs_prefix: SHINY.sockjs_prefix}}
);

var extractUserApp = function(url,prefix){
   var results;

   if (prefix)
      url = url.replace(prefix,'')
  
   results = /^\/([0-9.\-A-Za-z]+)\/([0-9.\-A-Za-z]+)(\/)?.*/.exec(url);

   
   if (!results) return null;

   return {
      user: results[1],
      app: results[2],
      hash: results[1]+'-'+results[2],
      rootUrl: '/' + results[1] + '/' + results[2],
      trailingSlash: (results[3] != undefined)? true : false
   };
}

var appIsProxied = function(hash){
   var i;
   for (i = 0; i < SHINY.proxied_apps.length; i += 1){
      if (SHINY.proxied_apps[i] === hash)
         return true;
   }
   return false;
}

var proxyApp = function(hash){
   SHINY.proxied_apps.push(hash);
}

var unproxyApp = function(hash){
   var i;
   for (i = 0; i < SHINY.proxied_apps.length; i += 1){
      if (SHINY.proxied_apps[i] === hash)
         SHINY.proxied_apps.splice(i,1);
   }
}

var sockjsProxyHandler = function(proc){
   var handler = function(conn) {
      var fmq, ws_is_open, ws, userApp;

      userApp = proc.user+'-'+proc.app;
      // Forwarding Message Queue
      fmq = [];

      ws_is_open = false;


      if (!proc) conn.close();

      ws = new websocket.Client('ws://'+proc.host+':'+proc.port+'/'); 

      console.log("ws("+userApp+"): "+conn.remotePort+"<->"+ws._uri.port+" ws open");

      ws.onopen = function(event){
         ws_is_open = true;
         var i;


         if (fmq.length){
            for (i = 0; i < fmq.length; i++){
               ws.send(fmq[i]);
            }
            fmq = [];
         }
      }

      ws.onmessage = function(event){
         console.log("ws("+userApp+"): "+conn.remotePort+"<- "+ws._uri.port);
         conn.write(event.data);
      };

      ws.onclose = function(event){
         console.log("ws("+userApp+"): "+conn.remotePort+" ->"+ws._uri.port+" close");
         conn.close();
         ws.close();
      };

      conn.on('data', function(message) {
         console.log("ws("+userApp+"): "+conn.remotePort+" ->"+ws._uri.port);
         if (ws_is_open){
            ws.send(message);
         } else {
            fmq.push(message);
         }
      });

      conn.on('close', function(message){
         console.log("ws("+userApp+"): "+conn.remotePort+"<- "+ws._uri.port+" close");
         ws.close();
         conn.close();
      });
   }
   return handler;
}

SHINY.proxy = httpProxy.createServer(function(req,res,proxy){
   var sockjs_server, shinyProc;
   var ua = extractUserApp(req.url);

   console.log('proxy: '+req.url);

   if (!ua){
      res.writeHead(400, {'Content-Type': 'text/html'});
      res.end('<h1>Bad Request!</h1>');
      return;
   }

   if (!ua.trailingSlash){
      newUrl = '/' + ua.user + '/' + ua.app + '/';
      res.writeHead(301, {
         'Content-Type': 'text/html', 
         'Location': newUrl
      });
      res.end('<h1><a href="'+newUrl+'">Moved Permanently</a></h1>');
      return;
   }

   shinyProc = SHINY.rmon.procInfo(ua.user,ua.app);

   if (!shinyProc)
      shinyProc = SHINY.rmon.startProc(ua.user,ua.app);

   if (shinyProc.status === "starting"){
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write('<html><head><meta http-equiv="refresh" content="3"></head>');
      res.end("<body><h1>Creating App. Just a Sec...</h1></body></html>");
   } else if (shinyProc.status === "nouser"){
      res.writeHead(400, {'Content-Type': 'text/html'});
      res.end('<h1>User '+ua.user+' Does Not Exist!</h1>');
   } else if (shinyProc.status === "dead"){
      res.writeHead(500, {'Content-Type': 'text/html'});
      res.end('<h1>Internal Error! Cannot start '+ua.hash+'!</h1>');
   } else if (shinyProc.status === "running"){
      req.url = req.url.replace(ua.rootUrl,'')
      proxy.proxyRequest(req,res,{
         host: shinyProc.host,
         port: shinyProc.port
      });
      if (!appIsProxied(ua.hash)){
         proxyApp(ua.hash);
         sockjs_server = sockjs.createServer();
         sockjs_server.on('connection', sockjsProxyHandler(shinyProc));
         sockjs_server.installHandlers(SHINY.proxy,{prefix: SHINY.sockjs_prefix+ua.rootUrl});
      }
   } else {
      res.writeHead(500, {'Content-Type': 'text/html'});
      res.end('<h1>Internal Error! End of rope!</h1>');
   }
});

SHINY.proxy.listen(SHINY.listen_port,SHINY.listen_addr);
