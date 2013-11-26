
/*
 * Default handler for proxies
 *
 * based on
 * http://wiki.ecmascript.org/doku.php?id=harmony:proxy_defaulthandler
 */

function Handler(target) {
  this.target = target;
};
 
Handler.prototype = {
 
  // == fundamental traps ==
 
  // Object.getOwnPropertyDescriptor(proxy, name) -> pd | undefined
  getOwnPropertyDescriptor: function(name) {
    var desc = Object.getOwnPropertyDescriptor(this.target, name);
    if (desc !== undefined) { desc.configurable = true; }
    return desc;
  },
 
  // Object.getPropertyDescriptor(proxy, name) -> pd | undefined
  getPropertyDescriptor: function(name) {
    var desc = Object.getPropertyDescriptor(this.target, name);
    if (desc !== undefined) { desc.configurable = true; }
    return desc;
  },
 
  // Object.getOwnPropertyNames(proxy) -> [ string ]
  getOwnPropertyNames: function() {
    return Object.getOwnPropertyNames(this.target);
  },
 
  // Object.getPropertyNames(proxy) -> [ string ]
  getPropertyNames: function() {
    return Object.getPropertyNames(this.target);
  },
 
  // Object.defineProperty(proxy, name, pd) -> undefined
  defineProperty: function(name, desc) {
    return Object.defineProperty(this.target, name, desc);
  },
 
  // delete proxy[name] -> boolean
  delete: function(name) { return delete this.target[name]; },
 
  // Object.{freeze|seal|preventExtensions}(proxy) -> proxy
  fix: function() {
    // As long as target is not frozen, the proxy won't allow itself to be fixed
    if (!Object.isFrozen(this.target)) {
      return undefined;
    }
    var props = {};
    Object.getOwnPropertyNames(this.target).forEach(function(name) {
      props[name] = Object.getOwnPropertyDescriptor(this.target, name);
    }.bind(this));
    return props;
  },
 
  // == derived traps ==
 
  // name in proxy -> boolean
  has: function(name) { return name in this.target; },
 
  // ({}).hasOwnProperty.call(proxy, name) -> boolean
  hasOwn: function(name) { return ({}).hasOwnProperty.call(this.target, name); },
 
  // proxy[name] -> any
  get: function(receiver, name) { return this.target[name]; },
 
  // proxy[name] = value
  set: function(receiver, name, value) {
   if (canPut(this.target, name)) { // canPut as defined in ES5 8.12.4 [[CanPut]]
     this.target[name] = value;
     return true;
   }
   return false; // causes proxy to throw in strict mode, ignore otherwise
  },
 
  // for (var name in proxy) { ... }
  enumerate: function() {
    var result = [];
    for (var name in this.target) { result.push(name); };
    return result;
  },
 
  /*
  // if iterators would be supported:
  // for (var name in proxy) { ... }
  iterate: function() {
    var props = this.enumerate();
    var i = 0;
    return {
      next: function() {
        if (i === props.length) throw StopIteration;
        return props[i++];
      }
    };
  },*/
 
  // Object.keys(proxy) -> [ string ]
  keys: function() { return Object.keys(this.target); }
};

module.exports = Handler;