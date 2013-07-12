var page = require('webpage').create(),
    system = require('system'),
    t, address;

if (system.args.length === 1) {
    console.log('Usage: loadtime.js <some URL>');
    phantom.exit();
}

t = Date.now();
var iter = 20;
var i = 0;

address = system.args[1];
function runTest() {
page.open(address, function (status) {
    if (status !== 'success') {
        console.log('FAIL to load the address');
    }
    i++;

   if ( i >= iter ){
	t = Date.now() - t;
	console.log('Loading time for ' + iter + ' iterations = ' + t + ' msec');
	phantom.exit();
   } else{
	runTest();
   }
});
}

runTest();
