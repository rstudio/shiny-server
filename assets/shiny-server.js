
(function( $ ) {
  function generateId(size){
    var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    var id = '';
    for (var i=0; i < size; i++) {
      var rnum = Math.floor(Math.random() * chars.length);
      id += chars.substring(rnum,rnum+1);
    }
    return id;
  }
  var robustId = generateId(18);

  var exports = window.ShinyServer = window.ShinyServer || {};
  exports.debugging = false;
  $(function() {
    if (typeof(Shiny) != "undefined") {
      (function() {
        var loc = location.pathname;
        loc = loc.replace(/\/$/, '');
        var sockjsUrl = loc + "/__sockjs__/n=" + robustId;

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
          function getRelativePath(from, to, includeLast) {

            // The last element would otherwise get trimmed off, if you want it,
            // add some garbage to the end that can be trimmed.
            if (includeLast){
              to += '/a';
            }

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
                var relURL = getRelativePath(window.parent.ShinyServer.url, sockjsUrl, true);
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
        };

        var availableOptions = {{{protocols}}}; 

        var store = null;
        var whitelist = [];

        if (supports_html5_storage()){
          store = window.localStorage;
          whitelistStr = store["shiny.whitelist"];
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

        var networkSelectorVisible = false;
        var networkSelector = undefined;
        var networkOptions = undefined;

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
        }

        $(document).keydown(function(event){
          if (event.shiftKey && event.ctrlKey && event.altKey && event.keyCode == 65){
            ShinyServer.toggleNetworkSelector();
          }
        });

        var toggleNetworkSelector = exports.toggleNetworkSelector = function(){
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

        exports.multiplexer = new MultiplexClient(sockjsUrl, whitelist);

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
      console.log(new Date() + ": " + msg);
    }
  }

  function log(msg) {
    if (window.console){
      console.log(new Date() + ": " + msg);
    }
  }

  // MultiplexClient sits on top of a SockJS connection and lets the caller
  // open logical SockJS connections (channels). The SockJS connection is
  // closed when all of the channels close. This means you can't start with
  // zero channels, open a channel, close that channel, and then open
  // another channel.
  function MultiplexClient(sockjsUrl, whitelist) {
    // The URL target for our SockJS connection(s)
    this._sockjsUrl = sockjsUrl;
    // The whitelisted SockJS protocols
    this._whitelist = whitelist;
    // Placeholder for our SockJS connection, once we open it.
    this._conn = null;
    // A table of all active channels.
    // Key: id, value: MultiplexClientChannel
    this._channels = {};
    this._channelCount = 0;
    // ID to use for the next channel that is opened
    this._nextId = 0;
    // Channels that need to be opened when the SockJS connection's open
    // event is received
    this._pendingChannels = [];
    // A list of functions that fire when our connection goes away.
    this.onclose = [];
    // Backlog of messages we need to send when we have a connection.
    this._buffer = [];
    // Whether or not this is our first connection.
    this._first = true;
    // No an updated value like readyState, but rather a Boolean which will be set
    // true when the server has indicated that this connection can't ever be resumed.
    this._diconnected = false;
    // The timer used to delay the display of the reconnecting dialog.
    this._disconnectTimer = null;
    // The message shown to be shown to the user in the dialog box
    this._dialogMsg = '';

    this._autoReconnect = {{{reconnect}}};
    
    var self = this;

    // Open an initial connection 
    this._openConnection_p()
    .fail(function(err){
      self._disconnected = true;
      self.onConnClose.apply(self, arguments);
    })
    .done();
  };
  MultiplexClient.prototype.open = function(url) {
    var channel = new MultiplexClientChannel(this, this._nextId++ + "",
                                             url);
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
  MultiplexClient.prototype._parseMultiplexData = function(msg) {
    try {
      var m = /^(\d+)\|(m|o|c|r)\|([\s\S]*)$/m.exec(msg);
      if (!m)
        return null;
      msg = {
        id: m[1],
        method: m[2],
        payload: m[3]
      };

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
        case 'r':
          break;
        default:
          return null;
      }

      return msg;

    } catch(e) {
      log('Error parsing multiplex data: ' + e);
      return null;
    }
  };
  // Open a new SockJS connection and assign it.
  MultiplexClient.prototype._openConnection_p = function(){
    var def = $.Deferred();

    var url = this._sockjsUrl;
    if (!this._first){
      // Communicate to the server that we're intending to re-use an existing ID.
      url = url.replace(/\/n=/, '/o=');
    }
    var conn = new SockJS(url,
      null,{protocols_whitelist: this._whitelist});
    var self = this;
    conn.onmessage = function(){
      self.onConnMessage.apply(self, arguments);
    }

    var self = this;

    // Temporarily override so we can resolve the promise
    conn.onopen = function(){
      // Successful open; restore onClose pass through to real open callback
      conn.onclose = function(){
        self.onConnClose.apply(self, arguments);
      };
      self.onConnOpen.apply(self, arguments);
      def.resolve(conn);
    };
    conn.onclose = function(err){
      // If we got here, means we didn't get to onopen, so it failed.
      def.reject(err);
    };

    this._conn = conn;

    return def;
  };
  MultiplexClient.prototype.onConnMessage = function(e) {
    var msg = this._parseMultiplexData(e.data);
    if (!msg) {
      log("Invalid multiplex packet received from server");
      this._conn.close();
      return;
    }
    var id = msg.id;
    var method = msg.method;
    var payload = msg.payload;
    var channel = this._channels[id];
    if (!channel) {
      log("Multiplex channel " + id + " not found");
      return;
    }
    if (method === "c") {
      // If we're closing, we want to close everything, not just a subapp.
      // So don't send to a single channel.
      this._conn.close();
    } else if (method === "m") {
      channel.onmessage({data: payload});
    } else if (method === "r") {
      this._disconnected = true;
      if (msg.payload.length > 0){
        alert(msg.payload);
      }
    }
  };
  MultiplexClient.prototype._doClose = function(){
    // If the SockJS connection is terminated from the other end (or due
    // to loss of connectivity or whatever) then we can notify all the
    // active channels that they are closed too.
    for (var key in this._channels) {
      if (this._channels.hasOwnProperty(key)) {
        this._channels[key]._destroy();
      }
    }
    for (var i = 0; i < this.onclose.length; i++) {
      this.onclose[i]();
    }

    if (this._disconnected){
      $('body').removeClass('ss-reconnecting');
      var html = '<button id="ss-reload-button" type="button" class="ss-dialog-button">Reload</button> Disconnected from the server.<div class="ss-clearfix"></div>';
      if ($('#ss-connect-dialog').length){
        // Update existing dialog
        $('#ss-connect-dialog').html(html);
        $('#ss-overlay').addClass('ss-gray-out');
      } else {
        // Create dialog from scratch.
        $('<div id="ss-connect-dialog">'+html+'</div><div id="ss-overlay" class="ss-gray-out"></div>').appendTo('body');
      }
      $('#ss-reload-button').click(function(){
        location.reload();
      });
    }
  };
  MultiplexClient.prototype.onConnOpen = function() {
    this._first = false;
    if (this._disconnectTimer){
      clearTimeout(this._disconnectTimer);
      this._disconnectTimer = null;
    }
    log("Connection opened. " + window.location.href);
    var channel;
    while ((channel = this._pendingChannels.shift())) {
      // Be sure to check readyState so we don't open connections for
      // channels that were closed before they finished opening
      if (channel.readyState === 0) {
        channel._open();
      } else {
        debug("NOT opening channel " + channel.id);
      }
    }

    // Send any buffered messages.
    var msg;
    while ((msg = this._buffer.shift())){
      this._conn.send(msg);
    }
  };
  MultiplexClient.prototype.onConnClose = function(e) {
    log("Connection closed. Info: " + JSON.stringify(e));

    // If the server intentionally closed the connection, don't attempt to come back.
    if (e && e.wasClean === true || ! this._autoReconnect){
      this._disconnected = true;
    }

    if (!this._disconnected) {
      this.startReconnect();
    } else {
      this._doClose();
    }
  };
  MultiplexClient.prototype.send = function(msg){
    if (this._conn.readyState === 1){
      this._conn.send(msg);
    } else {
      this._buffer.push(msg);
    }
  };
  MultiplexClient.prototype.setReconnectDialog = function(msg){
    // Buffer the msg in case this element isn't visible in the DOM now
    this._dialogMsg = msg;
    $('#ss-connect-dialog').html(msg);
  }
  MultiplexClient.prototype.reconnect_p = function(){
    this.setReconnectDialog('Attempting to reconnect...');
    var def = $.Deferred();

    log("Attempting to reopen.");

    this._openConnection_p()
    .then(function(){
      $('body').removeClass('ss-reconnecting');
      $('#ss-connect-dialog').remove();
      $('#ss-overlay').remove();
      def.resolve();
    }, function(err){
      // This was a failed attempt to reconnect
      log("Unable to reconnect: " + JSON.stringify(err));
      def.reject();
    });

    return def;
  }
  // @param time The last time a connection attempt was started
  // @param count 0-indexed count of how many reconnect attempts have occured.
  // @param expires the time when the session is scheduled to expire on 
  // the server.
  MultiplexClient.prototype.scheduleReconnect_p = function(time, count, expires) {
    var def = $.Deferred();

    if (Date.now() > expires){
      // Shouldn't happen, but if the current time is after the known
      // expiration for this session, give up.
      debug('Overshot session expiration.');
      return def.reject(new Error("Overshot session expiration"));
    }

    // Compute delay exponentially.
    var interval;
    var delay;
    if (count < 0){
      interval = 0;
      delay = 0;
    } else {
      if (count < 10){
        interval = 1000 * Math.pow(2, count);
        interval = Math.min(15 * 1000, interval); // Max of 15s delay.
      } else { 
        // The interval may end up being configurable or changed, so we don't cut off
        // exactly at 2^4, but don't bother computing really large powers.
        interval = 15 * 1000;
      }
      delay = time - Date.now() + interval;
    }

    // If the next attempt would be after the session is due to expire, 
    // schedule one last attempt to connect a couple seconds before the
    // expiration.
    if (Date.now() + delay > (expires - 2000)) {
      delay = expires - Date.now() - 2000;
    }
    if (delay < 0){
      // i.e. we're within 2 seconds of session expiration. Make
      // one last connection attmpt but don't schedule any more.
      debug('Final reconnection attempt');
      return this.reconnect_p();
    }

    var self = this;
    function doRecon(){
      var startTime = Date.now();
      self.reconnect_p()
      .then(function(c){
        // Able to reconnect.
        def.resolve(c);
      }, function(){
        self.scheduleReconnect_p(startTime, count+1, expires)
        .then(function(c){
          def.resolve(c);
        }, function(e){
          def.reject(e);
        });
      });
    }

    var reconTimeout = null;
    this.setReconnectDialog('<button id="ss-reconnect-btn" type="button" class="ss-dialog-button">Reconnect Now</button>Trouble connecting to server.');
    $('#ss-reconnect-btn').click(function(){
      debug('Trying to reconnect now.');
      // Short-circuit the wait.
      clearTimeout(reconTimeout);
      doRecon();
    });
    debug('Setting countdown timer');
    debug('Scheduling reconnect attempt for ' + delay + 'ms');
    // Schedule the reconnect for some time in the future.
    reconTimeout = setTimeout(doRecon, delay);

    return def;
  }
  MultiplexClient.prototype.startReconnect = function(){
    var self = this;

    // Schedule the display of the disconnect window
    self._disconnectTimer = setTimeout(function(){
      debug('Displaying disconnect screen.');
      $('body').addClass('ss-reconnecting');
      $('<div id="ss-connect-dialog">'+self._dialogMsg+'<div class="ss-clearfix"></div></div><div id="ss-overlay"></div>').appendTo('body');
    }, 3500);

    var timeout = 15; 


    // Attempt to reconnect immediately, then start scheduling.
    if (!self._disconnected){
      var time = Date.now();
      self.scheduleReconnect_p(time, -1, time + 15 * 1000)
      .fail(function(){
        // We were not able to re/connect
        self._disconnected = true;
        self._doClose();
      });
    } else {
      self._disconnected = true;
      self._doClose();
    }
    };

  function MultiplexClientChannel(owner, id, url) {
    this._owner = owner;
    this.id = id;
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

    this._owner.send(formatOpenEvent(this.id, this.url));
    this.onopen();
  };
  MultiplexClientChannel.prototype.send = function(data) {
    if (this.readyState === 0)
      throw new Error("Invalid state: can't send when readyState is 0");
    if (this.readyState === 1)
      this._owner.send(formatMessage(this.id, data));
  };
  MultiplexClientChannel.prototype.close = function(code, reason) {
    if (this.readyState >= 2)
      return;
    debug("Close channel " + this.id);
    if (this._owner.getConn().readyState === 1) {
      // Is the underlying connection open? Send a close message.
      this._owner.send(formatCloseEvent(this.id, code, reason));
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
  };

  function formatMessage(id, message) {
    return id + '|m|' + message;
  }
  function formatOpenEvent(id, url) {
    return id + '|o|' + url;
  }
  function formatCloseEvent(id, code, reason) {
    return id + '|c|' + JSON.stringify({code: code, reason: reason});
  }
})(jQuery);
