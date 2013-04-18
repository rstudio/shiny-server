// This is a PhantomJS script

var webpage = require('webpage');

function Visit(duration, url) {
  console.log('Launching ' + url);
  var page = webpage.create();
  page.open(url, function() {
    setTimeout(function() {
      if (page.close)
        page.close(); // phantomjs 1.6
      else
        page.release(); // phantomjs 1.8+
    }, duration);
  });
}

setInterval(function() {
  new Visit(Math.random() * 10000, 'http://localhost:3838/06_tabsets');
  return true;
}, 200);

setInterval(function() {
  new Visit(Math.random() * 10000, 'http://localhost:3838/09_upload');
  return true;
}, 200);

