let log = require("./log");
let util = require('./util');
let token = require('./decorators/token');
//let subapp = require('./subapp');
//let extendsession = require('./extendsession');
let reconnect = require('./decorators/reconnect');
let multiplex = require('./decorators/multiplex');
let sockjs = require("./sockjs");
let PromisedConnection = require("./promised-connection");
const ConnectionContext = require("./decorators/connection-context");
const ReconnectUI = require("./reconnect-ui");

/*
Connection factories:
- SockJS (reconnect-aware)
- Subapp

Connection factory decorators:
- WorkerId maintainer (reconnect-aware)
- Token adder
- Reconnector (requires underlying connections to be reconnect-aware)
- MultiplexClient

SSOS config:
  Primary app:
    SockJS + Reconnector + MultiplexClient
  Subapp:
    Subapp

SSP/RSC config:
  Primary app:
    SockJS + WorkerId + Token + Reconnector + MultiplexClient
  Subapp:
    Subapp
*/

let reconnectUI = new ReconnectUI();

/**
 * options = {
 *   reconnect: false
 *   debugging: false
 *   extendsession: false
 * }
 *
 */
function initSession(shiny, options) {
  let factory;

  if (false && subapp.isSubApp()) {
    // TODO
  } else {
    // Not a subapp
    // if (options.extendsession) {
    //   extendsession.init();
    // }

    factory = sockjs.createFactory(options);
    if (options.reconnect) {
      factory = reconnect.decorate(factory, options);
    }
    factory = multiplex.decorate(factory);
  }

  // Register the connection with Shiny.createSocket, etc.
  shiny.createSocket = function() {
    let url = location.protocol + "//" + location.host + location.pathname.replace(/\\$/, "");
    url += "/__sockjs__/";

    reconnectUI.hide();

    let doReconnectHandler = _ => {
      ctx.emit("do-reconnect");
    };

    reconnectUI.on("do-reconnect", doReconnectHandler);
    if (reconnectUI.listenerCount("do-reconnect") > 1) {
      log("do-reconnect handlers are leaking!");
    }

    let ctx = new ConnectionContext();
    ctx.on("reconnect-schedule", delay => {
      reconnectUI.showCountdown(delay);
    });
    ctx.on("reconnect-attempt", _ => {
      reconnectUI.showAttempting();
    });
    ctx.on("reconnect-success", _ => {
      reconnectUI.hide();
    });

    let onDisconnected = _ => {
      reconnectUI.removeListener("do-reconnect", doReconnectHandler);
      reconnectUI.showDisconnected();
    };
    ctx.on("reconnect-failure", onDisconnected);
    ctx.on("disconnect", onDisconnected);

    let pc = new PromisedConnection();

    factory(url, ctx, pc.resolve.bind(pc));
    return pc;
  };
}

global.preShinyInit = function(options) {
  initSession(global.Shiny, options);
}
