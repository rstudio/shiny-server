/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var Cookies = require("cookies");
var Proxy_ = (typeof Proxy !== 'undefined') ? Proxy : require("node-proxy");
var Handler = require("./ProxyHandler.js");
var crypto = require("crypto");

const COOKIE_NAME_SEP = '=';
const ACTIVE_DURATION = 1000 * 60 * 5;

function base64urlencode(arg) {
  var s = arg.toString('base64');
  s = s.split('=')[0]; // Remove any trailing '='s
  s = s.replace(/\+/g, '-'); // 62nd char of encoding
  s = s.replace(/\//g, '_'); // 63rd char of encoding
  // TODO optimize this; we can do much better
  return s;
}

function base64urldecode(arg) {
  var s = arg;
  s = s.replace(/-/g, '+'); // 62nd char of encoding
  s = s.replace(/_/g, '/'); // 63rd char of encoding
  switch (s.length % 4) // Pad with trailing '='s
  {
  case 0: break; // No pad chars in this case
  case 2: s += "=="; break; // Two pad chars
  case 3: s += "="; break; // One pad char
  default: throw new Error("Illegal base64url string!");
  }
  return new Buffer(s, 'base64'); // Standard base64 decoder
}

function deriveKey(master, type) {
  // eventually we want to use HKDF. For now we'll do something simpler.
  var hmac = crypto.createHmac('sha256', master);
  hmac.update(type);
  return hmac.digest('binary');
}

function constantTimeEquals(a, b) {
  // Ideally this would be a native function, so it's less sensitive to how the
  // JS engine might optimize.
  if (a.length != b.length)
    return false;
  var ret = 0;
  for (var i = 0; i < a.length; i++) {
    ret |= a.readUInt8(i) ^ b.readUInt8(i);
  }
  return ret == 0;
}

function encode(opts, content, duration, createdAt){
    // format will be:
    // iv.ciphertext.createdAt.duration.hmac

    if (!opts.cookieName) {
      throw new Error('cookieName option required');
    } else if (String(opts.cookieName).indexOf(COOKIE_NAME_SEP) != -1) {
      throw new Error('cookieName cannot include "="');
    }

    if (!opts.encryptionKey) {
      opts['encryptionKey'] = deriveKey(opts.secret, 'cookiesession-encryption');
    }

    if (!opts.signatureKey) {
      opts['signatureKey'] = deriveKey(opts.secret, 'cookiesession-signature');
    }

    duration = duration || 24*60*60*1000;
    createdAt = createdAt || new Date().getTime();

    // generate iv
    var iv = crypto.randomBytes(16);

    // encrypt with encryption key
    var plaintext = opts.cookieName + COOKIE_NAME_SEP + JSON.stringify(content);
    var cipher = crypto.createCipheriv('aes256', opts.encryptionKey, iv);
    var ciphertext = cipher.update(plaintext, 'utf8', 'binary');
    ciphertext += cipher.final('binary');
    // Before 0.10, crypto returns binary-encoded strings. Remove when
    // dropping 0.8 support.
    ciphertext = new Buffer(ciphertext, 'binary');

    // hmac it
    var hmacAlg = crypto.createHmac('sha256', opts.signatureKey);
    hmacAlg.update(iv);
    hmacAlg.update(".");
    hmacAlg.update(ciphertext);
    hmacAlg.update(".");
    hmacAlg.update(createdAt.toString());
    hmacAlg.update(".");
    hmacAlg.update(duration.toString());

    var hmac = hmacAlg.digest();
    // Before 0.10, crypto returns binary-encoded strings. Remove when
    // dropping 0.8 support.
    hmac = new Buffer(hmac, 'binary');

    return base64urlencode(iv) + "." + base64urlencode(ciphertext) + "." + createdAt + "." + duration + "." + base64urlencode(hmac);
}

function decode(opts, content) {

    // stop at any time if there's an issue
    var components = content.split(".");
    if (components.length != 5)
      return;

    if (!opts.cookieName) {
      throw new Error("cookieName option required");
    }

    if (!opts.encryptionKey) {
      opts['encryptionKey'] = deriveKey(opts.secret, 'cookiesession-encryption');
    }

    if (!opts.signatureKey) {
      opts['signatureKey'] = deriveKey(opts.secret, 'cookiesession-signature');
    }

    var iv = base64urldecode(components[0]);
    var ciphertext = base64urldecode(components[1]);
    var createdAt = parseInt(components[2], 10);
    var duration = parseInt(components[3], 10);
    var hmac = base64urldecode(components[4]);

    // make sure IV is right length
    if (iv.length != 16)
      return;

    // check hmac
    var hmacAlg = crypto.createHmac('sha256', opts.signatureKey);
    hmacAlg.update(iv);
    hmacAlg.update(".");
    hmacAlg.update(ciphertext);
    hmacAlg.update(".");
    hmacAlg.update(createdAt.toString());
    hmacAlg.update(".");
    hmacAlg.update(duration.toString());

    var expected_hmac = hmacAlg.digest();
    // Before 0.10, crypto returns binary-encoded strings. Remove when
    // dropping 0.8 support.
    expected_hmac = new Buffer(expected_hmac, 'binary');

    if (!constantTimeEquals(hmac, expected_hmac))
      return;

    // decrypt
    var cipher = crypto.createDecipheriv('aes256', opts.encryptionKey, iv);
    var plaintext = cipher.update(ciphertext, 'binary', 'utf8');
    plaintext += cipher.final('utf8');

    var cookieName = plaintext.substring(0, plaintext.indexOf(COOKIE_NAME_SEP));
    if (cookieName !== opts.cookieName) {
      return;
    }

    try {
      return {
        content: JSON.parse(plaintext.substring(plaintext.indexOf(COOKIE_NAME_SEP) + 1)),
        createdAt: createdAt,
        duration: duration
      };
    } catch (x) {
      return;
    }
}

/*
 * Session object
 *
 * this should be implemented with proxies at some point
 */
function Session(req, res, cookies, opts) {
  this.req = req;
  this.res = res;
  this.cookies = cookies;
  this.opts = opts;
  if (opts.cookie.ephemeral && opts.cookie.maxAge) {
    throw new Error("you cannot have an ephemeral cookie with a maxAge.");
  }

  this.content = {};
  this.loaded = false;
  this.dirty = false;

  // no need to initialize it, loadFromCookie will do
  // via reset() or unbox()
  this.createdAt = null;
  this.duration = opts.duration;
  this.activeDuration = opts.activeDuration;

  // support for maxAge
  if (opts.cookie.maxAge) {
    this.expires = new Date(new Date().getTime() + opts.cookie.maxAge);
  } else {
    this.updateDefaultExpires();
  }

  // here, we check that the security bits are set correctly
  var secure = (res.socket && res.socket.encrypted) || (req.connection && req.connection.proxySecure);
  if (opts.cookie.secure && !secure)
    throw new Error("you cannot have a secure cookie unless the socket is secure or you declare req.connection.proxySecure to be true.");
}

Session.prototype = {
  updateDefaultExpires: function() {
    if (this.opts.cookie.maxAge) return;

    if (this.opts.cookie.ephemeral) {
      this.expires = null;
    } else {
      var time = this.createdAt || new Date().getTime();
      // the cookie should expire when it becomes invalid
      // we add an extra second because the conversion to a date truncates the milliseconds
      this.expires = new Date(time + this.duration + 1000);
    }
  },

  clearContent: function(keysToPreserve) {
    var self = this;
    Object.keys(this.content).forEach(function(k) {
      // exclude this key if it's meant to be preserved
      if (keysToPreserve && (keysToPreserve.indexOf(k) > -1))
        return;

      delete self.content[k];
    });
  },

  reset: function(keysToPreserve) {
    this.clearContent(keysToPreserve);
    this.createdAt = new Date().getTime();
    this.duration = this.opts.duration;
    this.updateDefaultExpires();
    this.dirty = true;
    this.loaded = true;
  },

  setDuration: function(newDuration, ephemeral) {
    if (ephemeral && this.opts.cookie.maxAge) {
      throw new Error("you cannot have an ephemeral cookie with a maxAge.");
    }
    if (!this.loaded)
      this.loadFromCookie(true);
    this.dirty = true;
    this.duration = newDuration;
    this.createdAt = new Date().getTime();
    this.opts.cookie.ephemeral = ephemeral;
    this.updateDefaultExpires();
  },

  // take the content and do the encrypt-and-sign
  // boxing builds in the concept of createdAt
  box: function() {
    return encode(this.opts, this.content, this.duration, this.createdAt);
  },

  unbox: function(content) {
    this.clearContent();

    var unboxed = decode(this.opts, content);
    if (!unboxed) return;

    var self = this;

    Object.keys(unboxed.content).forEach(function(k) {
      self.content[k] = unboxed.content[k];
    });

    this.createdAt = unboxed.createdAt;
    this.duration = unboxed.duration;
    this.updateDefaultExpires();
  },

  updateCookie: function() {
    if (this.dirty) {
      // support for adding/removing cookie expires
      this.opts.cookie.expires = this.expires;

      try {
        this.cookies.set(this.opts.cookieName, this.box(), this.opts.cookie);
      } catch (x) {
        // this really shouldn't happen. Right now it happens if secure is set
        // but cookies can't determine that the connection is secure.
      }
    }
  },

  loadFromCookie: function(force_reset) {
    var cookie = this.cookies.get(this.opts.cookieName);
    if (cookie) {
      this.unbox(cookie);

      var expiresAt = this.createdAt + this.duration;
      var now = Date.now();
      // should we reset this session?
      if (expiresAt < now)
        this.reset();
      // if expiration is soon, push back a few minutes to not interrupt user
      else if (expiresAt - now < this.activeDuration) {
        this.createdAt += this.activeDuration;
        this.dirty = true;
        this.updateDefaultExpires();
      }
    } else {
      if (force_reset) {
        this.reset();
      } else {
        return false; // didn't actually load the cookie
      }
    }

    this.loaded = true;
    return true;
  },

  // called to create a proxy that monitors the session
  // for new properties being set
  monitor: function() {
    // the target for the proxy will be the content
    // variable, to simplify the proxying
    var sessionHandler = new Handler(this.content);
    var raw_session = this;

    // all values from content except special values
    sessionHandler.get = function(rcvr, name) {
      if (['reset'].indexOf(name) > -1) {
        return raw_session[name].bind(raw_session);
      } else if (['setDuration'].indexOf(name) > -1) {
        return raw_session[name].bind(raw_session);
      } else {
        if (!raw_session.loaded) {
          var didLoad = raw_session.loadFromCookie();
          if (!didLoad) return undefined;
        }
        return this.target[name];
      }
    };

    // set all values to content
    sessionHandler.set = function(rcvr, name, value) {
      // we have to load existing content, otherwise it will later override
      // the content that is written.
      if (!raw_session.loaded)
        raw_session.loadFromCookie(true);

      this.target[name] = value;
      raw_session.dirty = true;
    };

    // if key is deleted
    sessionHandler.delete = function(name) {
      // we have to load existing content, otherwise it will later override
      // the content that is written.
      if (!raw_session.loaded) {
        var didLoad = raw_session.loadFromCookie();
        if (!didLoad) return;
      }

      delete this.target[name];
      raw_session.dirty = true;
    };

    var proxySession = Proxy_.create(sessionHandler);
    return proxySession;
  }
};



var cookieSession = function(opts) {
  if (!opts)
    throw "no options provided, some are required"; // XXX rename opts?

  if (!opts.secret)
    throw "cannot set up sessions without a secret";

  // defaults
  opts.cookieName = opts.cookieName || "session_state";
  opts.duration = opts.duration || 24*60*60*1000;
  opts.activeDuration = 'activeDuration' in opts ? opts.activeDuration : ACTIVE_DURATION;

  // set up cookie defaults
  opts.cookie = opts.cookie || {};
  if (typeof(opts.cookie.httpOnly) == 'undefined')
    opts.cookie.httpOnly = true;

  // let's not default to secure just yet,
  // as this depends on the socket being secure,
  // which is tricky to determine if proxied.
  /*
  if (typeof(opts.cookie.secure) == 'undefined')
    opts.cookie.secure = true;
    */

  // derive two keys, one for signing one for encrypting, from the secret.
  opts.encryptionKey = deriveKey(opts.secret, 'cookiesession-encryption');
  opts.signatureKey = deriveKey(opts.secret, 'cookiesession-signature');

  const propertyName = opts.requestKey || opts.cookieName;

  return function(req, res, next) {
    if (req[propertyName]) {
      return next(); //self aware
    }

    var cookies = new Cookies(req, res);
    var raw_session;
    try {
      raw_session = new Session(req, res, cookies, opts);
    } catch (x) {
      // this happens only if there's a big problem
      process.nextTick(function() {next("client-sessions error: " + x.toString());});
      return;
    }

    req[propertyName] = raw_session.monitor();

    var writeHead = res.writeHead;
    res.writeHead = function () {
      raw_session.updateCookie();
      return writeHead.apply(res, arguments);
    }

    next();
  };
};

module.exports = cookieSession;


// Expose encode and decode method

module.exports.util = {
  encode: encode,
  decode: decode
};
