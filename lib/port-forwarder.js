//
// Simple port forwarder. Handles unlimited connections.
// 
// Call like so:
//
// node port-forwarder.js listenaddr listenport forwardaddr forwardport
//
// Example
//
// node port-forwarder.js localhost 7000 localhost 8124
//
//
var ARGS = {
   listen_address: process.argv[2],
   listen_port: process.argv[3],
   forward_address: process.argv[4],
   forward_port: process.argv[5]
};

var net = require("net");

var server = net.createServer(function (ca) {
   console.log("client connected, forwarding to "+
      ARGS.forward_address+":"+ARGS.forward_port);
   var cb = net.connect(ARGS.forward_port, ARGS.forward_address);
   cb.on("data", function (data) {
      ca.write(data);
   });
   cb.on("end", function () {
      cb.end();
      ca.end();
   });
   cb.on("close", function () {
      cb.end();
      ca.end();
   });

   ca.on("data", function (data) {
      cb.write(data);
   });

   ca.on("end", function () {
      ca.end();
      cb.end();
   });

   ca.on("close", function () {
      ca.end();
      cb.end();
   });
});
server.listen(ARGS.listen_port, ARGS.listen_address, function(){
   console.log("server listening on "+ARGS.listen_address+":"+ARGS.listen_port);
});
