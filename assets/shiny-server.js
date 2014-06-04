(function( $ ) {
  var exports = window.ShinyServer = window.ShinyServer || {};
  $(function() {
    if (typeof(Shiny) != "undefined") {
      (function() {
        var loc = location.pathname;
        loc = loc.replace(/\/$/, '');
        var sockjsUrl = loc + "/__sockjs__/";

        var subApp = window.location.search.match(/\?.*__subapp__=(\d)/);
        if (subApp && subApp[1]) {
          Shiny.createSocket = function() {
            try {
              if (window.parent.ShinyServer && window.parent.ShinyServer.multiplexer) {
                return window.parent.ShinyServer.multiplexer.open(sockjsUrl);
              }
              console.log("Couldn't get multiplexer: multiplexer not found in parent");
            } catch (e) {
              console.log("Couldn't get multiplexer: " + e);
            }

            var fakeSocket = {};
            setTimeout(function() {
              if (fakeSocket.onclose) {
                fakeSocket.onclose();
              }
            }, 0);
          };
          return;
        }

        var supports_html5_storage = exports.supports_html5_storage = function() {
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
          '<div style="position: relative; width: 300px; margin-left: -150px; padding: .5em 1em 0 1em; height: 400px; margin-top: -190px; background-color: #FAFAFA; border: 1px solid #CCC; font.size: 1.2em;">'+
          '<h3>Select Network Methods</h3>' +
          '<div id="networkOptions"></div>' + 
          '<div id="network-prot-warning" style="color: #44B">'+(supports_html5_storage()?'':"These network settings can only be configured in browsers that support HTML5 Storage. Please update your browser or unblock storage for this domain.")+'</div>' +
          '<div style="float: right;">' +
            '<input type="button" value="Reset" onclick="ShinyServer.enableAll()"></input>' +
            '<input type="button" value="OK" onclick="ShinyServer.toggleNetworkSelector();" style="margin-left: 1em;" id="netOptOK"></input>' +
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

        exports.multiplexer = new MultiplexClient(
          new SockJS(sockjsUrl,null,{protocols_whitelist: whitelist})
        );

        Shiny.createSocket = function() {
          return exports.multiplexer.open(sockjsUrl);
        };

        Shiny.oncustommessage = function(message) {
          if (typeof message === "string") alert(message); // Legacy format
          if (message.alert) alert(message.alert);
          if (message.console && console.log) console.log(message.console);
        };

      })();
    }
  });

  function MultiplexClient(conn) {
    this._conn = conn;
    this._channels = {};
    this._nextId = 0;
    this._pendingChannels = [];

    var self = this;
    this._conn.onopen = function() {
      var channel;
      while ((channel = self._pendingChannels.shift())) {
        channel.open();
      }
    };
    this._conn.onclose = function() {
      for (var key in self._channels) {
        if (self._channels.hasOwnProperty(key)) {
          self._channels[key].readyState = 3;
          self._channels[key].onclose();
        }
      }
    };
    this._conn.onmessage = function(e) {
      var msg = parseMultiplexData(e.data);
      if (!msg) {
        console.log("Invalid multiplex packet received from server");
        self._conn.close();
        return;
      }
      var id = msg[0];
      var method = msg[1];
      var payload = msg[2];
      var channel = self._channels[id];
      if (!channel) {
        console.log("Multiplex channel " + id + " not found");
        return;
      }
      if (method === "c") {
        channel.readyState = 3;
        channel.onclose(payload.code, payload.reason);
      } else if (method === "m") {
        channel.onmessage({data: payload});
      }
    };
  }
  MultiplexClient.prototype.open = function(url) {
    var channel = new MultiplexClientChannel(this._nextId++ + "",
                                             this._conn, url);
    this._channels[channel.id] = channel;

    switch (this._conn.readyState) {
      case 0:
        this._pendingChannels.push(channel);
        break;
      case 1:
        setTimeout(function() {
          channel.open();
        }, 0);
        break;
      default:
        setTimeout(function() {
          channel.close();
        });
        break;
    }
    return channel;
  };

  function MultiplexClientChannel(id, conn, url) {
    this.id = id;
    this.conn = conn;
    this.url = url;
    this.readyState = 0;
    this.onopen = function() {};
    this.onerror = function() {};
    this.onclose = function() {};
    this.onmessage = function() {};
  }
  MultiplexClientChannel.prototype.open = function() {
    this.readyState = 1;
    this.conn.send(formatOpenEvent(this.id, this.url));
    this.onopen();
  };
  MultiplexClientChannel.prototype.send = function(data) {
    if (this.readyState === 0)
      throw new Error("Invalid state: can't send when readyState is 0");
    if (this.readyState === 1)
      this.conn.send(formatMessage(this.id, data));
  };
  MultiplexClientChannel.prototype.close = function(code, reason) {
    // Is the underlying connection open? Send a close message.
    if (this.conn.readyState === 1) {
      this.conn.send(formatCloseEvent(this.id, code, reason));
    }
    // If we haven't already, invoke onclose handler.
    if (this.readyState !== 3) {
      this.readyState = 3;
      this.onclose();
    }
  };

  function formatMessage(id, message) {
    return JSON.stringify([id, 'm', message]);
  }
  function formatOpenEvent(id, url) {
    return JSON.stringify([id, 'o', url]);
  }
  function formatCloseEvent(id, code, reason) {
    return JSON.stringify([id, 'c', {code: code, reason: reason}]);
  }
  function parseMultiplexData(msg) {
    try {
      msg = JSON.parse(msg);
    }
    catch(e) {
      return null;
    }

    var len = msg.length;
    if (len < 2)
      return null;
    if (typeof(msg[0]) !== 'string' && msg[0].length > 0)
      return null;
    switch (msg[1]) {
      case 'm':
        if (len != 3 || typeof(msg[2]) !== 'string')
          return null;
        break;
      // case 'o' is not valid in the client
      case 'c':
        if (len != 3 || typeof(msg[2].code) !== 'number' ||
            typeof(msg[2].reason) !== 'string') {
          return null;
        }
        break;
      default:
        return null;
    }

    return msg;
  }
})(jQuery);