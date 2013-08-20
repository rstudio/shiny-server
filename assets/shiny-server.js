if (typeof(Shiny) != "undefined") {
  (function() {
    Shiny.createSocket = function() {
      return new SockJS(location.pathname + "__sockjs__/",null,{});
    };
    Shiny.oncustommessage = function(message) {
      if (typeof message === "string") alert(message); // Legacy format
      if (message.alert) alert(message.alert);
      if (message.console && console.log) console.log(message.console);
    };
  })();

}
