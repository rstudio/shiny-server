var Q = require('q');
var qutil = require('../lib/core/qutil');

var sersleep = qutil.serialized(function(ms) {
  var defer = Q.defer();
  console.log('Sleeping for ' + ms);
  setTimeout(function() {
    defer.resolve(null);
  }, ms);
  return defer.promise;
});

sersleep(1000).then(function() {console.log('1 done');});
sersleep(2000).then(function() {console.log('2 done');});
sersleep(3000).then(function() {console.log('3 done');});
sersleep(4000).then(function() {console.log('4 done');});
