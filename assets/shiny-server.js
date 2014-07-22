
(function( $ ) {
  var exports = window.ShinyServer = window.ShinyServer || {};
  exports.debugging = false;
  $(function() {
    if (typeof(Shiny) != "undefined") {
      (function() {
        var loc = location.pathname;
        loc = loc.replace(/\/$/, '');
        var sockjsUrl = loc + "/__sockjs__/";

        exports.url = sockjsUrl;

        var subApp = window.location.search.match(/\?.*__subapp__=(\d)/);
        if (subApp && subApp[1]) {
          // Take from nodeJS's path module.
          // The doc's on this function are lacking, but it looks like the last 
          // element in each path is treated as a file (regardless of the
          // presence/absence of a trailing slash). So the relativePath from 
          // `/foo/a` to `/foo/b` is the empty string, since you're already
          // in the right directory -- the same holds true if you add trailing
          // slashes to the above examples. So if we want to resolve the
          // relative difference between the above two dirs, we need to add 
          // something to each, like `/whatever/`, then we'd get '../b'.
          // This is why we append `__sockjs__` to each path before comparing.
          function getRelativePath(from, to) {
            function trim(arr) {
              var start = 0;
              for (; start < arr.length; start++) {
                if (arr[start] !== '') break;
              }

              var end = arr.length - 1;
              for (; end >= 0; end--) {
                if (arr[end] !== '') break;
              }

              if (start > end) return [];
              return arr.slice(start, end - start + 1);
            }

            var fromParts = trim(from.split('/'));
            var toParts = trim(to.split('/'));

            var length = Math.min(fromParts.length, toParts.length);
            var samePartsLength = length;
            for (var i = 0; i < length; i++) {
              if (fromParts[i] !== toParts[i]) {
                samePartsLength = i;
                break;
              }
            }

            var outputParts = [];
            for (var i = samePartsLength; i < fromParts.length; i++) {
              outputParts.push('..');
            }

            outputParts = outputParts.concat(toParts.slice(samePartsLength));

            return outputParts.join('/');
          }

          Shiny.createSocket = function() {
            try {
              if (window.parent.ShinyServer && window.parent.ShinyServer.multiplexer) {
                var relURL = getRelativePath(window.parent.ShinyServer.url, sockjsUrl);
                return window.parent.ShinyServer.multiplexer.open(relURL);
              }
              log("Couldn't get multiplexer: multiplexer not found in parent");
            } catch (e) {
              log("Couldn't get multiplexer: " + e);
            }

            var fakeSocket = {};
            setTimeout(function() {
              if (fakeSocket.onclose) {
                fakeSocket.onclose();
              }
            }, 0);
          };
          Shiny.oncustommessage = function(message) {
            if (typeof message === "string" && console.log) console.log(message); // Legacy format
            if (message.alert && console.log) console.log(message.alert);
            if (message.console && console.log) console.log(message.console);
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
          var opt = $('<label><input type="checkbox" id="ss-net-opt-'+val+'" name="shiny-server-proto-checkbox" value="'+index+'" '+
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
          return exports.multiplexer.open("");
        };

        Shiny.oncustommessage = function(message) {
          if (typeof message === "string") alert(message); // Legacy format
          if (message.alert) alert(message.alert);
          if (message.console && console.log) console.log(message.console);
        };

      })();
    }
  });

  function debug(msg) {
    if (window.console && exports.debugging){
      console.log(msg);
    }
  }

  function log(msg) {
    if (window.console){
      console.log(msg);
    }
  }

  // MultiplexClient sits on top of a SockJS connection and lets the caller
  // open logical SockJS connections (channels). The SockJS connection is
  // closed when all of the channels close. This means you can't start with
  // zero channels, open a channel, close that channel, and then open
  // another channel.
  function MultiplexClient(conn) {
    // The underlying SockJS connection. At this point it is not likely to
    // be opened yet.
    this._conn = conn;
    // A table of all active channels.
    // Key: id, value: MultiplexClientChannel
    this._channels = {};
    this._channelCount = 0;
    // ID to use for the next channel that is opened
    this._nextId = 0;
    // Channels that need to be opened when the SockJS connection's open
    // event is received
    this._pendingChannels = [];

    var self = this;
    this._conn.onopen = function() {
      var channel;
      while ((channel = self._pendingChannels.shift())) {
        // Be sure to check readyState so we don't open connections for
        // channels that were closed before they finished opening
        if (channel.readyState === 0) {
          channel._open();
        } else {
          debug("NOT opening channel " + channel.id);
        }
      }
    };
    this._conn.onclose = function() {
      debug("SockJS connection closed");
      // If the SockJS connection is terminated from the other end (or due
      // to loss of connectivity or whatever) then we can notify all the
      // active channels that they are closed too.
      for (var key in self._channels) {
        if (self._channels.hasOwnProperty(key)) {
          self._channels[key]._destroy();
        }
      }
    };
    this._conn.onmessage = function(e) {
      var msg = parseMultiplexData(e.data);
      if (!msg) {
        log("Invalid multiplex packet received from server");
        self._conn.close();
        return;
      }
      var id = msg.id;
      var method = msg.method;
      var payload = msg.payload;
      var channel = self._channels[id];
      if (!channel) {
        log("Multiplex channel " + id + " not found");
        return;
      }
      if (method === "c") {
        // If we're closing, we want to close everything, not just a subapp.
        // So don't send to a single channel.
        self._conn.close();
      } else if (method === "m") {
        channel.onmessage({data: payload});
      }
    };
  }
  MultiplexClient.prototype.open = function(url) {
    var channel = new MultiplexClientChannel(this, this._nextId++ + "",
                                             this._conn, url);
    this._channels[channel.id] = channel;
    this._channelCount++;

    switch (this._conn.readyState) {
      case 0:
        this._pendingChannels.push(channel);
        break;
      case 1:
        setTimeout(function() {
          channel._open();
        }, 0);
        break;
      default:
        setTimeout(function() {
          channel.close();
        }, 0);
        break;
    }
    return channel;
  };
  MultiplexClient.prototype.removeChannel = function(id) {
    delete this._channels[id];
    this._channelCount--;
    debug("Removed channel " + id + ", " + this._channelCount + " left");
    if (this._channelCount === 0 && this._conn.readyState < 2) {
      debug("Closing SockJS connection since no channels are left");
      this._conn.close();
    }
  };

  function MultiplexClientChannel(owner, id, conn, url) {
    this._owner = owner;
    this.id = id;
    this.conn = conn;
    this.url = url;
    this.readyState = 0;
    this.onopen = function() {};
    this.onclose = function() {};
    this.onmessage = function() {};
  }
  MultiplexClientChannel.prototype._open = function(parentURL) {
    debug("Open channel " + this.id);
    this.readyState = 1;

    //var relURL = getRelativePath(parentURL, this.url)
    
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
    if (this.readyState >= 2)
      return;
    debug("Close channel " + this.id);
    if (this.conn.readyState === 1) {
      // Is the underlying connection open? Send a close message.
      this.conn.send(formatCloseEvent(this.id, code, reason));
    }
    this._destroy(code, reason);
  };
  // Internal version of close that doesn't notify the server
  MultiplexClientChannel.prototype._destroy = function(code, reason) {
    var self = this;
    // If we haven't already, invoke onclose handler.
    if (this.readyState !== 3) {
      this.readyState = 3;
      debug("Channel " + this.id + " is closed");
      setTimeout(function() {
        self._owner.removeChannel(self.id);
        self.onclose();
      }, 0);
    }
  }

  function formatMessage(id, message) {
    return id + '|m|' + message;
  }
  function formatOpenEvent(id, url) {
    return id + '|o|' + url;
  }
  function formatCloseEvent(id, code, reason) {
    return id + '|c|' + JSON.stringify({code: code, reason: reason});
  }
  function parseMultiplexData(msg) {
    try {
      var m = /^(\d+)\|(m|o|c)\|([\s\S]*)$/m.exec(msg);
      if (!m)
        return null;
      msg = {
        id: m[1],
        method: m[2],
        payload: m[3]
      }

      switch (msg.method) {
        case 'm':
          break;
        case 'o':
          if (msg.payload.length === 0)
            return null;
          break;
        case 'c':
          try {
            msg.payload = JSON.parse(msg.payload);
          } catch(e) {
            return null;
          }
          break;
        default:
          return null;
      }

      return msg;

    } catch(e) {
      logger.debug('Error parsing multiplex data: ' + e);
      return null;
    }
  }
})(jQuery);
