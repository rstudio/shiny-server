// 
// shiny-proxy.js: A shiny proxy server using sockjs
//
// [browser] <-----sockjs-----> [shiny-proxy] <----websockets----> [shiny app]
// 
// Call like:
//
// node shiny-proxy-2.js
//
// And edit the below SHINY object
//
//
SHINY = {
   listen_addr: '0.0.0.0',
   listen_port: 8000
};

var util = require('util'),
    http = require('http'),
    httpProxy = require('http-proxy'),
    sockjs = require('sockjs'),
    websocket = require('faye-websocket'),
    url = require('url'),
    getpwnam = require('./etcpasswd').getpwnam;

var sockjs_server = sockjs.createServer();

sockjs_server.on('connection', function(conn) {
   
   // Forwarding Message Queue
   var fmq = [];

   var ws = new websocket.Client('ws://'+SHINY.forward_addr+':'+SHINY.forward_port+'/'); 

	var ws_is_open = false;

   ws.onopen = function(event){
		ws_is_open = true;
		var i;

      console.log("conn: "+conn.url+" ws open");

      if (fmq.length){
			for (i = 0; i < fmq.length; i++){
         	ws.send(fmq[i]);
			}
			fmq = [];
      }
   }

   ws.onmessage = function(event){
      console.log("conn: "+conn.url+" ws message");
      conn.write(event.data);
   };

   ws.onclose = function(event){
      console.log("conn: "+conn.url+" ws close");
      conn.close();
      ws.close();
   };

   conn.on('data', function(message) {
      console.log('conn: '+conn.url+' data');
      if (ws_is_open){
         ws.send(message);
      } else {
         fmq.push(message);
      }
   });

   conn.on('close', function(message){
      console.log('conn: '+conn.url+' close');
      ws.close();
      conn.close();
   });
});

var extractUserApp = function(url){
   var results = /^\/([0-9.\-A-Za-z]+)\/([0-9.\-A-Za-z]+)(\/)?.*/.exec(url);

   
   if (!results) return null;

   return {
      user: results[1],
      app: results[2],
      trailingSlash: (results[3] != undefined)? true : false
   };
}

var PROXY = httpProxy.createServer(function(req,res,proxy){

   userApp = extractUserApp(req.url);

   if (!userApp){
      res.writeHead(400, {'Content-Type': 'text/html'});
      res.end('<h1>Bad Request!</h1>');
      return;
   }

   if (!userApp.trailingSlash){
      newUrl = '/' + userApp.user + '/' + userApp.app + '/';
      res.writeHead(301, {
         'Content-Type': 'text/html', 
         'Location': newUrl
      });
      res.end('<h1><a href="'+newUrl+'">Moved Permanently</a></h1>');
   }

   // Testing now
   res.writeHead(200, {'Content-Type': 'text/plain'});
   res.end(util.inspect(userApp));
   return;

   //proxy.proxyRequest(req,res,{
   //   host: SHINY.forward_addr, 
   //   port: SHINY.forward_port
   //});
});

sockjs_server.installHandlers(PROXY, {prefix:'/sockjs'});

PROXY.listen(SHINY.listen_port,SHINY.listen_addr);
