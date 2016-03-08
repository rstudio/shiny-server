"use strict";

let $ = global.jQuery;

exports.onLoggedIn = onLoggedIn;
function onLoggedIn(credentials) {
  if (!credentials)
    return;

  var user = credentials.user;
  var str = '<div class="shiny-server-account">' +
    '  Logged in as <span class="shiny-server-username"></span>';
  if (credentials.strategy !== 'proxy-auth') {
    str += '  <a href="__logout__">Logout</a>';
  }
  str += '</div>';
  var div = $(str);
  div.find('.shiny-server-username').text(user);
  $('body').append(div);
}

function formatDate(date) {
  if (!date)
    return '?/?/????';

  var months = ['January', 'February', 'March', 'April', 'May',
    'June', 'July', 'August', 'September', 'October', 'November',
    'December'];
  return months[date.getMonth()] + ' ' + date.getDate() + ', ' +
    date.getFullYear();
}

exports.onLicense = onLicense;
function onLicense(Shiny, license) {
  if (!license)
    return;
  if (license.status !== 'expired' && license.status !== 'grace')
    return;

  var noun = license.evaluation ? 'evaluation' : 'license';
  var message = 'Your Shiny Server ' + noun + ' expired';
  if (license.expiration)
    message += ' on ' + formatDate(new Date(license.expiration));
  message += '.';

  if (license.status === 'expired') {
    setTimeout(function() {
      window.alert(message + '\n\n' +
        'Please purchase and activate a license.');
    }, 0);
    if (Shiny && Shiny.shinyapp && Shiny.shinyapp.$socket) {
      Shiny.shinyapp.$socket.close();
    }
  } else if (license.status === 'grace') {
    $('.shiny-server-expired').remove();
    var div = $(
      '<div class="shiny-server-expired">' +
      'WARNING: ' + message +
      '</div>'
    );
    $('body').append(div);
    setTimeout(function() {
      div.animate({
        top: -(div.height() + 16 /* total vertical padding */)
      }, 'slow', function() {
        div.remove();
      });
    }, 8000);
  }
}
