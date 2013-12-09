#!../bin/node/bin/node

var http = require('http');
var parse = require('url').parse;

var Q = require('q');
var WebSocket = require('faye-websocket');


// Set SOCKET_PATH to a full path to force all HTTP and WS requests
// to go to a Unix domain socket rather than over TCP/IP.
var SOCKET_PATH = null;

// Set to true if the target URL is a Shiny Server instance; set it
// to false if the target URL is running on a bare Shiny instance.
var SHINY_SERVER = true;

// This class creates a UrlLoader and WebSocketLoader that are pointed
// to the appUrl that you give it. The appUrl should end with a slash.
function AppLoader(appUrl, initMsg) {
  var urls = [
    "",
    "shared/jquery.js",
    "shared/shiny.js",
    "shared/shiny.css",
    "shared/slider/css/jquery.slider.min.css",
    "shared/slider/js/jquery.slider.min.js",
    "shared/bootstrap/css/bootstrap.min.css",
    "shared/bootstrap/js/bootstrap.min.js",
    "shared/bootstrap/css/bootstrap-responsive.min.css",
    "__assets__/sockjs-0.3.min.js",
    "shared/bootstrap/img/glyphicons-halflings.png",
    "shared/slider/img/jslider.plastic.png",
    "__sockjs__/info"
  ];

  this._urlLoader = new UrlLoader(appUrl, urls, function(req, data) {
    return data.replace(/"entropy":\d+/, '"entropy":[redacted]');
  });

  var ent1 = Math.floor(100 + Math.random() * 899);
  var ent2 = Math.floor(100000000 + Math.random() * 900000000);
  var wsUrl = appUrl.replace(/^http/, 'ws') + '__sockjs__/' + ent1 + '/' + ent2 + '/websocket';
  this._wsLoader = new WebSocketLoader(wsUrl, initMsg);
}

(function() {

  this.run_p = function() {
    return Q.all([
      this._urlLoader.run_p(),
      this._wsLoader.run_p()
    ]);
  };

}).call(AppLoader.prototype);

function WebSocketLoader(url, initMsg) {
  this._url = url;
  this._initMsg = initMsg;
}

(function() {
  this.run_p = function() {
    var self = this;

    var deferred = Q.defer();

    var outputReceived = false;

    var options = {};
    if (typeof(SOCKET_PATH) === 'string')
      options.socketPath = SOCKET_PATH;
    var ws = new WebSocket.Client(this._url, undefined, options);
    function onOpen() {
      var initMsg = JSON.stringify(self._initMsg);
      
      // This line is only needed for shiny-server, since SockJS expects
      // this framing of messages
      if (SHINY_SERVER)
        initMsg = JSON.stringify([initMsg]);
      ws.send(initMsg);
    }
    ws.on('open', function(event) {
      if (!SHINY_SERVER)
        onOpen();
    });
    ws.on('message', function(event) {
     try {
        var messages;
        // Check for SockJS framing; see "Protocol and framing" at
        // http://sockjs.github.io/sockjs-protocol/sockjs-protocol-0.3.3.html
        if (event.data === 'o') {
          if (SHINY_SERVER)
            onOpen();
          return;
        } else if (event.data === 'h' || event.data[0] === 'c') {
          return;
        } else if (event.data[0] === 'a') {
          messages = JSON.parse(event.data.substr(1)).map(function(msg) {
            return JSON.parse(msg);
          });
        } else {
          // Raw WebSocket
          messages = [JSON.parse(event.data)];
        }

        messages.forEach(function(msg) {
          if (!msg.config && !msg.values && !msg.progress && !msg.errors) {
            throw new Error('Unexpected message: ' + event.data);
          }
          if (msg.values) {
            outputReceived = true;
            ws.close();
          }
        })
      } catch (e) {
        console.log(event.data);
        deferred.reject(e);
      }
    });
    ws.on('close', function(event) {
      if (!outputReceived) {
        deferred.reject(new Error('Websocket closed without receiving output'));
      } else {
        deferred.resolve(true);
      }
    });
    ws.on('error', function(event) {
      deferred.reject(new Error('ws error event fired'));
    });

    return deferred.promise
    .fin(function() {
      ws.close();
    });
  };
}).call(WebSocketLoader.prototype);

function UrlLoader(baseUrl, urls, filter) {
  this._results = {};
  this._urls = urls.map(function(url) { return baseUrl + url; });
  this._filter = filter;
  this.requestCount = 0;
}

(function() {

  this.run_p = function() {
    var self = this;
    var promises = this._urls.map(function(url) {
      var options = parse(url);
      
      if (typeof(SOCKET_PATH) === 'string') {
        options.host = null;
        options.hostname = null;
        options.port = null;
        options.socketPath = SOCKET_PATH;
      }
      
      //options.agent = false;
      var deferred = Q.defer();

      var req = http.get(options, function(res) {
        var respdata = res.statusCode + "\n";
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
          respdata += chunk.toString();
        });
        res.on('end', function() {
          if (res.statusCode !== 200) {
            // Allow 404s for URLs that are only expected for Shiny Server
            if (!/__assets__|__sockjs__/.test(url) || res.statusCode != 404) {
              console.log(respdata);
              deferred.reject(new Error('Status code ' + res.statusCode + ' for URL ' + url));
              return;
            }
          }

          respdata = self._filter(req, respdata);
          if (typeof(self._results[url]) === 'undefined') {
            self._results[url] = respdata;
          } else {
            if (self._results[url] !== respdata) {
              console.log(
                '\n\n\nEXPECTED: =================\n\n' +
                self._results[url] +
                '\n\n\nACTUAL: ===================\n\n' +
                respdata +
                '\n\n'
              );
              deferred.reject(
                new Error('Unexpected results for URL ' + url)
              );
              return;
            }
          }
          deferred.resolve(respdata);
        });
      })
      .on('error', function(e) {
        deferred.reject(e);
      });
      this.requestCount += 1;
      return deferred.promise;
    }, this);

    return Q.all(promises);
  };

}).call(UrlLoader.prototype);

var argv = process.argv;

if (argv.length < 3) {
  console.error('\nUsage: loadtest.js <shiny-url> [session-count]\n');
  console.error('where <shiny-url> points to a shiny-server-hosted 01_hello.');
  console.error('The default value for session-count is 200.');
  console.error();
  console.error('To change to a different app, capture the "init" websocket');
  console.error('message using the Network tab in Chrome Developer Tools and');
  console.error('modify the end of this script.');
  console.error();
  console.error('To use a raw Shiny app instead of shiny-server, modify the');
  console.error('SHINY_SERVER variable at the top of this script.')
  console.error();
  process.exit(1);
}

// Make sure we can open a whole lot of concurrent HTTP connections
http.globalAgent.maxSockets = 750;
var url = process.argv[2];
var sessionCount = +(argv[3] || 200);
console.log('URL:        ' + url);
console.log('Sessions:   ' + sessionCount);

// The second parameter is the message that will be sent to the server upon
// websocket connection. This needs to be tailored for each application; this 
// one is for the Shiny 01_hello example app.
var appLoader = new AppLoader(url, {
  "method":"init",
  "data":{
    "obs":500,
    ".clientdata_output_distPlot_width":910,
    ".clientdata_output_distPlot_height":400,
    ".clientdata_output_distPlot_hidden":false,
    ".clientdata_pixelratio":1,
    ".clientdata_url_protocol":"http:",
    ".clientdata_url_hostname":"localhost",
    ".clientdata_url_port":"8100",
    ".clientdata_url_pathname":"/",
    ".clientdata_url_search":"",
    ".clientdata_url_hash_initial":"",
    ".clientdata_singletons":"d9824d41b9a6aefe883ba073d83925ecd8434247",
    ".clientdata_allowDataUriScheme":true,

  }
});

var promises = [];
for (var i = 0; i < sessionCount; i++)
  promises.push(appLoader.run_p());
Q.all(promises)
.done();