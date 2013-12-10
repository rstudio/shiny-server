#!../bin/node/bin/node

var http = require('http');
var parse = require('url').parse;
http.globalAgent.maxSockets = 750;

var appUrl = "http://localhost:3838/01_hello/";

process.on('uncaughtException', function (err) {
  console.log('Caught exception: ' + err);
});

function startSession(appUrl, callback) {
  require('crypto').randomBytes(12, function(ex, buf) {
    if (ex) {
      throw ex;
    }
    var token = buf.toString('hex');
    var sockjsEndpoint = appUrl + "__sockjs__/123/" + token + "/";
    callback(sockjsEndpoint);
  });
}

var requestId = 0;
function go() {
  startSession(appUrl, function(sockjsUrl) {
    var id = requestId++;
    var opts = parse(sockjsUrl + "xhr_streaming");
    opts.method = "POST";
    var req = http.request(opts, function(res) {
      console.log(id + ' xhr_streaming response: ' + res.statusCode);
      res.on('data', function(chunk) {
        //console.log('data: ' + chunk);
        console.log(id + ' data');
      });
    });
    req.setTimeout(3000, function() {
      console.log(id + ' xhr_streaming timed out');
      req.abort();
      go();
    });
    req.end();
    console.log(id + ' xhr_streaming request sent');

    var opts2 = parse(sockjsUrl + "xhr_send");
    opts2.method = "POST";
    var req2 = http.request(opts2, function(res) {
      console.log(id + ' xhr_send response: ' + res.statusCode);
    });
    req2.end("[\"{\\\"method\\\":\\\"init\\\",\\\"data\\\":{\\\"obs\\\":500,\\\".clientdata_output_distPlot_width\\\":840,\\\".clientdata_output_distPlot_height\\\":400,\\\".clientdata_output_distPlot_hidden\\\":false,\\\".clientdata_pixelratio\\\":1,\\\".clientdata_url_protocol\\\":\\\"http:\\\",\\\".clientdata_url_hostname\\\":\\\"localhost\\\",\\\".clientdata_url_port\\\":\\\"3838\\\",\\\".clientdata_url_pathname\\\":\\\"/01_hello/\\\",\\\".clientdata_url_search\\\":\\\"\\\",\\\".clientdata_url_hash_initial\\\":\\\"\\\",\\\".clientdata_singletons\\\":\\\"d9824d41b9a6aefe883ba073d83925ecd8434247\\\",\\\".clientdata_allowDataUriScheme\\\":true}}\"]", "UTF-8");
  });
}

for (var i = 0; i < 50; i++) {
  go();
}