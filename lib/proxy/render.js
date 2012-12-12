var fs = require('fs');
var Handlebars = require('handlebars');
var _ = require('underscore');

exports.sendPage = sendPage;
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
      fs.readFileSync(__dirname + '/../../templates/' + config.template + '.html', 'utf-8'));

  response.writeHead(status, headers);
  response.end(template(_.extend({title: title}, config.vars)));
}

exports.sendClientConsoleMessage = sendClientConsoleMessage;
/**
 * Sends the given string to the client, where it will be printed to the
 * JavaScript error console (if available).
 */
function sendClientConsoleMessage(ws, message) {
  var msg = JSON.stringify({
    custom: {
      console: message
    }
  });
  ws.write(msg);
}

exports.sendClientAlertMessage = sendClientAlertMessage;
/**
 * Sends the given string to the client, where it will be displayed as a
 * JavaScript alert message.
 */
function sendClientAlertMessage(ws, alert) {
  var msg = JSON.stringify({
    custom: {
      alert: alert
    }
  });
  ws.write(msg);
}