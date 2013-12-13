(function( $ ) {
  var exports = window.ShinyServer = window.ShinyServer || {};
  $(function() {
    if (typeof(Shiny) != "undefined") {
      (function() {
        var supports_html5_storage = exports.supports_html5_storage = function() {
          return true;
          try {
            return 'localStorage' in window && window['localStorage'] !== null;
          } catch (e) {
            return false;
          }
        }

        var availableOptions = ['websocket', 'xdr-streaming', 'xhr-streaming', 
            'iframe-eventsource', 'iframe-htmlfile', 'xdr-polling', 
            'xhr-polling', 'iframe-xhr-polling', 'jsonp-polling'];

        var store = null;
        var whitelist = [];        

        if (supports_html5_storage()){
          store = window.localStorage;
          whitelistStr = store["shiny.whitelist"];
          if (!whitelistStr || whitelistStr === ""){
            whitelist = availableOptions;
          } else{
            whitelist = JSON.parse(whitelistStr);
          }
        } 
  
        if (!whitelist){
          whitelist = availableOptions;
        }

        var networkSelector = $('<div style="top: 50%; left: 50%; position: absolute;">' + 
          '<div style="position: relative; width: 300px; margin-left: -150px; padding: .5em 1em 0 1em; height: 380px; margin-top: -190px; background-color: #FAFAFA; border: 1px solid #CCC; font.size: 1.2em;">'+
          '<h3>Select Network Methods</h3>' +
          '<div id="networkOptions"></div>' + 
          '<div id="network-prot-warning" style="color: #44B">'+(supports_html5_storage()?'':"These network settings can only be configured in browsers that support HTML5 Storage. Please update your browser.")+'</div>' +
          '<div style="float: right;">' +
            '<button onclick="ShinyServer.enableAll()">Reset</button>' +
            '<button onclick="ShinyServer.toggleNetworkSelector();" style="margin-left: 1em;" id="netOptOK">OK</button>' +
          '</div>' +
          '</div></div>');
        $('body').append(networkSelector); 

        var networkOptions = $('#networkOptions', networkSelector);

        $.each(availableOptions, function(index, val){
          var checked = ($.inArray(val, whitelist) >= 0);
          var opt = $('<label><input type="checkbox" id="ss-net-opt-'+val+'" name="checkbox" value="'+index+'" '+
            (ShinyServer.supports_html5_storage()?'':'disabled="disabled"')+
            '> '+val+'</label>').appendTo(networkOptions);
          var checkbox = $('input', opt);
          checkbox.change(function(evt){
            ShinyServer.setOption(val, $(evt.target).prop('checked'));
          });
          if (checked){
            checkbox.prop('checked', true);
          }
        });

        var networkSelectorVisible = false;
        networkSelector.hide();


        $(document).keydown(function(event){
          if (event.shiftKey && event.ctrlKey && event.altKey && event.keyCode == 65){
            ShinyServer.toggleNetworkSelector();
          }
        });

        var toggleNetworkSelector = exports.toggleNetworkSelector = function(){
          if (networkSelectorVisible){
            // hide
            networkSelectorVisible = false;
            networkSelector.hide(200);
          } else{
            // show
            networkSelectorVisible = true;
            networkSelector.show(200);
          }
        }

        var enableAll = exports.enableAll = function(){
          $('input', networkOptions).each(function(index, val){
            $(val).prop('checked', true)
          });
          // Enable each protocol internally
          $.each(availableOptions, function(index, val){
            setOption(val, true);
          });
        }

        /**
         * Doesn't update the DOM, just updates our internal model.
         */
        var setOption = exports.setOption = function(option, enabled){
          $("#network-prot-warning").html("Updated settings will be applied when you refresh your browser or load a new Shiny application.");
          if (enabled && $.inArray(option, whitelist) === -1){
            whitelist.push(option);
          }
          if (!enabled && $.inArray(option, whitelist >= 0)){
            // Don't remove if it's the last one, and recheck
            if (whitelist.length === 1){
              $("#network-prot-warning").html("You must leave at least one method selected.");
              $("#ss-net-opt-" + option).prop('checked', true);
            } else{
              whitelist.splice($.inArray(option, whitelist), 1);  
            }
          }
          store["shiny.whitelist"] = JSON.stringify(whitelist);
        }

        Shiny.createSocket = function() {
          return new SockJS(location.pathname + "__sockjs__/",null,{protocols_whitelist: whitelist});
        };
        Shiny.oncustommessage = function(message) {
          if (typeof message === "string") alert(message); // Legacy format
          if (message.alert) alert(message.alert);
          if (message.console && console.log) console.log(message.console);
        };

      })();
    }
  });
})(jQuery);