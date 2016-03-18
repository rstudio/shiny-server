"use strict";

const EventEmitter = require("events").EventEmitter;
const inherits = require("inherits");

let $ = global.jQuery;

const dialogHtml = '<div id="ss-connect-dialog" style="display: none;"></div><div id="ss-overlay" class="ss-gray-out" style="display: none;"></div>';
const countdownContentsHtml = '<label>Reconnect failed. Retrying in <span id="ss-dialog-countdown"></span> seconds...</label> <a id="ss-reconnect-link" href="#" class="ss-dialog-link">Try now</a>';
const reconnectContentsHtml = '<label>Attempting to reconnect...</label><label>&nbsp;</label>';
const disconnectContentsHtml = '<label>Disconnected from the server.</label> <a id="ss-reload-link" href="#" class="ss-dialog-link">Reload</a>';

module.exports = ReconnectUI;

function ReconnectUI() {
  EventEmitter.call(this);

  $(() => {
    var dialog = $(dialogHtml);
    dialog.appendTo('body');

    $(document).on("click", '#ss-reconnect-link', e => {
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
  $('#ss-connect-dialog').html(countdownContentsHtml);
  $('#ss-connect-dialog').show();
  // $('#ss-overlay').show();

  function updateCountdown(seconds /* optional */) {
    if (typeof(seconds) === "undefined") {
      seconds = Math.max(0, Math.floor((attemptTime - Date.now()) / 1000)) + "";
    }
    $("#ss-dialog-countdown").html(seconds);
  }
  updateCountdown(Math.round(delay / 1000));
  if (delay > 15000) {
    let updateInterval = setInterval(function() {
      if (Date.now() > attemptTime) {
        clearInterval(updateInterval);
      } else {
        updateCountdown();
      }
    }, 15000);
  }
};

ReconnectUI.prototype.showAttempting = function() {
  $('body').addClass('ss-reconnecting');
  $("#ss-connect-dialog").html(reconnectContentsHtml);
  $('#ss-connect-dialog').show();
  // $('#ss-overlay').show();
};

ReconnectUI.prototype.hide = function() {
  $('body').removeClass('ss-reconnecting');
  $('#ss-connect-dialog').hide();
  $('#ss-overlay').hide();
};

ReconnectUI.prototype.showDisconnected = function() {
  $('#ss-connect-dialog').html(disconnectContentsHtml).show();
  $('#ss-overlay').show();
  $('body').removeClass('ss-reconnecting');
  $('#ss-overlay').addClass('ss-gray-out');
};
