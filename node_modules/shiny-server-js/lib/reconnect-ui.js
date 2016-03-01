const EventEmitter = require("events");
const inherits = require("inherits");

module.exports = ReconnectUI;

function ReconnectUI() {
  EventEmitter.call(this);

  $(_ => {
    var dialog = $('<div id="ss-connect-dialog" style="display: none;"></div><div id="ss-overlay" class="ss-gray-out" style="display: none;"></div>');
    dialog.appendTo('body');

    $('#ss-reconnect-link').click(e => {
      e.preventDefault();
      this.emit("do-reconnect");
    });
    $(document).on("click", "#ss-reload-link", e => {
      e.preventDefault();
      window.location.reload();
    });
  });
}

inherits(ReconnectUI, EventEmitter);

// Relevant events:
//
// Reconnect SCHEDULED
// Reconnect ATTEMPTING
// Reconnect SUCEEDED
// Reconnect FAILURE (final failure)

// States:
// Everything up to first disconnect: show nothing
// On reconnect attempt: Show "Attempting to reconnect [Cancel]"
// On disconnect or reconnect failure: Show "Reconnecting in x seconds [Try now]"
// On reconnect success: show nothing
// On stop: "Connection lost [Reload]"

ReconnectUI.prototype.showCountdown = function(delay) {
  if (delay < 200)
    return;
  let attemptTime = Date.now() + delay;
  $('#ss-connect-dialog').html('<a id="ss-reconnect-link" href="#" class="ss-dialog-link">Reconnect Now</a> Reconnect failed. Retrying in <span id="ss-dialog-countdown"></span> seconds');
  $('#ss-connect-dialog').show();
  // $('#ss-overlay').show();

  function updateCountdown() {
    $("#ss-dialog-countdown").html(Math.max(0, Math.floor((attemptTime - Date.now()) / 1000)));
  }
  updateCountdown();
  let updateInterval = setInterval(function() {
    updateCountdown();
    if (Date.now() > attemptTime)
      clearInterval(updateInterval);
  }, 100);
};

ReconnectUI.prototype.showAttempting = function() {
  $('body').addClass('ss-reconnecting');
  $("#ss-connect-dialog").html("Attempting to reconnect...");
  $('#ss-connect-dialog').show();
  // $('#ss-overlay').show();
};

ReconnectUI.prototype.hide = function() {
  $('body').removeClass('ss-reconnecting');
  $('#ss-connect-dialog').hide();
  $('#ss-overlay').hide();
};

ReconnectUI.prototype.showDisconnected = function() {
  var html = '<a id="ss-reload-link" href="#" class="ss-dialog-link">Reload</a> Disconnected from the server.';

  $('#ss-connect-dialog').html(html).show();
  $('#ss-overlay').show();
  $('body').removeClass('ss-reconnecting');
  $('#ss-overlay').addClass('ss-gray-out');
};
