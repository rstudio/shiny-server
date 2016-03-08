"use strict";

exports.isSubApp = isSubApp;
function isSubApp(){
  var subApp = global.location.search.match(/\?.*__subapp__=(\d)/);
  return (subApp && subApp[1]); //is truthy
}

exports.createSocket = createSocket;
function createSocket() {
  if (!window.parent || !window.parent.ShinyServer || !window.parent.ShinyServer.multiplexer) {
    throw new Error("Multiplexer not found in parent");
  }

  var relURL = window.frameElement.getAttribute("src");
  // Add /__sockjs__/ to the end of the path
  relURL = relURL.replace(/\/?(\?.*|$)/, "/__sockjs__/");
  return window.parent.ShinyServer.multiplexer.open(relURL);
}
