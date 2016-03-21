"use strict";

let $ = global.jQuery;
let ShinyServer = global.ShinyServer;

let whitelist = [];

Object.defineProperty(exports, "whitelist", {
  get: function() {
    return whitelist;
  }
});

function supports_html5_storage() {
  // window.localStorage is allowed to throw a SecurityError, so we must catch
  try {
    return 'localStorage' in window && window['localStorage'] !== null;
  } catch (e) {
    return false;
  }
}

let availableOptions = ["websocket","xdr-streaming","xhr-streaming","iframe-eventsource","iframe-htmlfile","xdr-polling","xhr-polling","iframe-xhr-polling","jsonp-polling"];

let store = null;

if (supports_html5_storage()){
  store = window.localStorage;
  let whitelistStr = store["shiny.whitelist"];
  if (!whitelistStr || whitelistStr === ""){
    whitelist = availableOptions;
  } else{
    whitelist = JSON.parse(whitelistStr);
    // Regardless of what the user set, disable any protocols that aren't offered by the server.
    $.each(whitelist, function(i, p){
      if ($.inArray(p, availableOptions) === -1){
        // Then it's not a valid option
        whitelist.splice($.inArray(p, whitelist), 1);
      }
    });
  }
}

if (!whitelist){
  whitelist = availableOptions;
}

let networkSelectorVisible = false;
let networkSelector = undefined;
let networkOptions = undefined;

// Build the SockJS network protocol selector.
//
// Has the side-effect of defining values for both "networkSelector"
// and "networkOptions".
function buildNetworkSelector() {
  networkSelector = $('<div style="top: 50%; left: 50%; position: absolute; z-index: 99999;">' +
                   '<div style="position: relative; width: 300px; margin-left: -150px; padding: .5em 1em 0 1em; height: 400px; margin-top: -190px; background-color: #FAFAFA; border: 1px solid #CCC; font.size: 1.2em;">'+
                   '<h3>Select Network Methods</h3>' +
                   '<div id="ss-net-opts"></div>' +
                   '<div id="ss-net-prot-warning" style="color: #44B">'+(supports_html5_storage()?'':"These network settings can only be configured in browsers that support HTML5 Storage. Please update your browser or unblock storage for this domain.")+'</div>' +
                   '<div style="float: right;">' +
                   '<input type="button" value="Reset" onclick="ShinyServer.enableAll()"></input>' +
                   '<input type="button" value="OK" onclick="ShinyServer.toggleNetworkSelector();" style="margin-left: 1em;" id="netOptOK"></input>' +
                   '</div>' +
                   '</div></div>');

  networkOptions = $('#ss-net-opts', networkSelector);
  $.each(availableOptions, function(index, val){
    let checked = ($.inArray(val, whitelist) >= 0);
    let opt = $('<label><input type="checkbox" id="ss-net-opt-'+val+'" name="shiny-server-proto-checkbox" value="'+index+'" '+
                (supports_html5_storage()?'':'disabled="disabled"')+
                '> '+val+'</label>').appendTo(networkOptions);
    let checkbox = $('input', opt);
    checkbox.change(function(evt){
      ShinyServer.setOption(val, $(evt.target).prop('checked'));
    });
    if (checked){
      checkbox.prop('checked', true);
    }
  });
}

$(document).keydown(function(event){
  if (event.shiftKey && event.ctrlKey && event.altKey && event.keyCode == 65){
    toggleNetworkSelector();
  }
});

ShinyServer.toggleNetworkSelector = toggleNetworkSelector;
function toggleNetworkSelector(){
  if (networkSelectorVisible) {
    networkSelectorVisible = false;
    networkSelector.hide();
  } else {
    // Lazily build the DOM for the selector the first time it is toggled.
    if (networkSelector === undefined) {
      buildNetworkSelector();
      $('body').append(networkSelector);
    }

    networkSelectorVisible = true;
    networkSelector.show();
  }
}

ShinyServer.enableAll = enableAll;
function enableAll(){
  $('input', networkOptions).each(function(index, val){
    $(val).prop('checked', true);
  });
  // Enable each protocol internally
  $.each(availableOptions, function(index, val){
    setOption(val, true);
  });
}

/**
 * Doesn't update the DOM, just updates our internal model.
 */
ShinyServer.setOption = setOption;
function setOption(option, enabled){
  $("#ss-net-prot-warning").html("Updated settings will be applied when you refresh your browser or load a new Shiny application.");
  if (enabled && $.inArray(option, whitelist) === -1){
    whitelist.push(option);
  }
  if (!enabled && $.inArray(option, whitelist >= 0)){
    // Don't remove if it's the last one, and recheck
    if (whitelist.length === 1){
      $("#ss-net-prot-warning").html("You must leave at least one method selected.");
      $("#ss-net-opt-" + option).prop('checked', true);
    } else{
      whitelist.splice($.inArray(option, whitelist), 1);
    }
  }
  store["shiny.whitelist"] = JSON.stringify(whitelist);
}
