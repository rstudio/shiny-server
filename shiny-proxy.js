// 
// shiny-proxy.js: A shiny proxy server using sockjs
//
// [browser] <-----sockjs-----> [shiny-proxy] <----websockets----> [shiny app]
// 
// Currently supports only one client and one shiny app
//
// Call like:
//
// node shiny-proxy.js
//
// And edit the below SHINY object
//
//
SHINY = {
   forward_addr: '127.0.0.1',
   forward_port: 9000,
   listen_addr: '127.0.0.1',
   listen_port: 8000
};

var util = require('util'),
    http = require('http'),
    httpProxy = require('http-proxy'),
    sockjs = require('sockjs'),
    websocket = require('faye-websocket'),
    wsapi = require('./node_modules/faye-websocket/lib/faye/websocket/api');


var sockjs_server = sockjs.createServer();

sockjs_server.on('connection', function(conn) {
   console.log("creating forward ws connection");
   var ws = new websocket.Client('ws://'+SHINY.forward_addr+':'+SHINY.forward_port+'/'); 
   
   var message_pending = null;

   ws.onopen = function(event){
      console.log("conn: "+conn.url+" ws open");
      if (message_pending){
         ws.send(message_pending);
         message_pending = null;
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
      if (ws.readyState == wsapi.OPEN){
         ws.send(message);
      } else if (message_pending == null){
         message_pending = message;
      } else {
         console.log('conn: '+conn.url+' ws sync error!');
         conn.close();
         ws.close();
      }
   });

   conn.on('close', function(message){
      console.log('conn: '+conn.url+' close');
      ws.close();
      conn.close();
   });
});

var proxy = httpProxy.createServer(SHINY.forward_port, SHINY.forward_addr);

sockjs_server.installHandlers(proxy, {prefix:'/sockjs'});

proxy.listen(SHINY.listen_port,SHINY.listen_addr);
