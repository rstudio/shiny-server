/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cookies = require("cookies");

const crypto = require("crypto");
const util = require("util");


const COOKIE_NAME_SEP = '=';
const ACTIVE_DURATION = 1000 * 60 * 5;

const KDF_ENC = 'cookiesession-encryption';
const KDF_MAC = 'cookiesession-signature';

/* map from cipher algorithm to exact key byte length */
const ENCRYPTION_ALGORITHMS = {
  aes128: 16, // implicit CBC mode
  aes192: 24,
  aes256: 32
};
const DEFAULT_ENCRYPTION_ALGO = 'aes256';

/* map from hmac algorithm to _minimum_ key byte length */
const SIGNATURE_ALGORITHMS = {
  'sha256': 32,
  'sha256-drop128': 32,
  'sha384': 48,
  'sha384-drop192': 48,
  'sha512': 64,
  'sha512-drop256': 64
 };
const DEFAULT_SIGNATURE_ALGO = 'sha256';

function isObject(val) {
  return Object.prototype.toString.call(val) === '[object Object]';
}

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
  switch (s.length % 4) { // Pad with trailing '='s
    case 0:
      break; // No pad chars in this case
    case 2:
      s += "==";
      break; // Two pad chars
    case 3:
      s += "=";
      break; // One pad char
    default:
      throw new Error("Illegal base64url string!");
  }
  return new Buffer(s, 'base64'); // Standard base64 decoder
}

function forceBuffer(binaryOrBuffer) {
  if (Buffer.isBuffer(binaryOrBuffer)) {
    return binaryOrBuffer;
  } else {
    return new Buffer(binaryOrBuffer, 'binary');
  }
}

function deriveKey(master, type) {
  // eventually we want to use HKDF. For now we'll do something simpler.
  var hmac = crypto.createHmac('sha256', master);
  hmac.update(type);
  return forceBuffer(hmac.digest());
}

function setupKeys(opts) {
  // derive two keys, one for signing one for encrypting, from the secret.
  if (!opts.encryptionKey) {
    opts.encryptionKey = deriveKey(opts.secret, KDF_ENC);
  }

  if (!opts.signatureKey) {
    opts.signatureKey = deriveKey(opts.secret, KDF_MAC);
  }

  if (!opts.signatureAlgorithm) {
    opts.signatureAlgorithm = DEFAULT_SIGNATURE_ALGO;
  }

  if (!opts.encryptionAlgorithm) {
    opts.encryptionAlgorithm = DEFAULT_ENCRYPTION_ALGO;
  }
}

function keyConstraints(opts) {
  if (!Buffer.isBuffer(opts.encryptionKey)) {
    throw new Error('encryptionKey must be a Buffer');
  }
  if (!Buffer.isBuffer(opts.signatureKey)) {
    throw new Error('signatureKey must be a Buffer');
  }

  if (constantTimeEquals(opts.encryptionKey, opts.signatureKey)) {
    throw new Error('Encryption and Signature keys must be different');
  }

  var encAlgo = opts.encryptionAlgorithm;
  var required = ENCRYPTION_ALGORITHMS[encAlgo];
  if (opts.encryptionKey.length !== required) {
    throw new Error(
      'Encryption Key for '+encAlgo+' must be exactly '+required+' bytes '+
      '('+(required*8)+' bits)'
    );
  }

  var sigAlgo = opts.signatureAlgorithm;
  var minimum = SIGNATURE_ALGORITHMS[sigAlgo];
  if (opts.signatureKey.length < minimum) {
    throw new Error(
      'Encryption Key for '+sigAlgo+' must be at least '+minimum+' bytes '+
      '('+(minimum*8)+' bits)'
    );
  }
}

function constantTimeEquals(a, b) {
  // Ideally this would be a native function, so it's less sensitive to how the
  // JS engine might optimize.
  if (a.length !== b.length) {
    return false;
  }
  var ret = 0;
  for (var i = 0; i < a.length; i++) {
    ret |= a.readUInt8(i) ^ b.readUInt8(i);
  }
  return ret === 0;
}

// it's good cryptographic pracitice to not leave buffers with sensitive
// contents hanging around.
function zeroBuffer(buf) {
  for (var i = 0; i < buf.length; i++) {
    buf[i] = 0;
  }
  return buf;
}

function hmacInit(algo, key) {
  var match = algo.match(/^([^-]+)(?:-drop(\d+))?$/);
  var baseAlg = match[1];
  var drop = match[2] ? parseInt(match[2], 10) : 0;

  var hmacAlg = crypto.createHmac(baseAlg, key);
  var origDigest = hmacAlg.digest;

  if (drop === 0) {
    // Before 0.10, crypto returns binary-encoded strings. Remove when dropping
    // 0.8 support.
    hmacAlg.digest = function() {
      return forceBuffer(origDigest.call(this));
    };
  } else {
    var N = drop / 8; // bits to bytes
    hmacAlg.digest = function dropN() {
      var result = forceBuffer(origDigest.call(this));
      // Throw away the second half of the 512-bit result, leaving the first
      // 256-bits.
      var truncated = new Buffer(N);
      result.copy(truncated, 0, 0, N);
      zeroBuffer(result);
      return truncated;
    };
  }

  return hmacAlg;
}

function computeHmac(opts, iv, ciphertext, duration, createdAt) {
  var hmacAlg = hmacInit(opts.signatureAlgorithm, opts.signatureKey);

  hmacAlg.update(iv);
  hmacAlg.update(".");
  hmacAlg.update(ciphertext);
  hmacAlg.update(".");
  hmacAlg.update(createdAt.toString());
  hmacAlg.update(".");
  hmacAlg.update(duration.toString());

  return hmacAlg.digest();
}

function encode(opts, content, duration, createdAt){
  // format will be:
  // iv.ciphertext.createdAt.duration.hmac

  if (!opts.cookieName) {
    throw new Error('cookieName option required');
  } else if (String(opts.cookieName).indexOf(COOKIE_NAME_SEP) !== -1) {
    throw new Error('cookieName cannot include "="');
  }

  setupKeys(opts);

  duration = duration || 24*60*60*1000;
  createdAt = createdAt || new Date().getTime();

  // generate iv
  var iv = crypto.randomBytes(16);

  // encrypt with encryption key
  var plaintext = new Buffer(
    opts.cookieName + COOKIE_NAME_SEP + JSON.stringify(content),
    'utf8'
  );
  var cipher = crypto.createCipheriv(
    opts.encryptionAlgorithm,
    opts.encryptionKey,
    iv
  );

  var ciphertextStart = forceBuffer(cipher.update(plaintext));
  zeroBuffer(plaintext);
  var ciphertextEnd = forceBuffer(cipher.final());
  var ciphertext = Buffer.concat([ciphertextStart, ciphertextEnd]);
  zeroBuffer(ciphertextStart);
  zeroBuffer(ciphertextEnd);

  // hmac it
  var hmac = computeHmac(opts, iv, ciphertext, duration, createdAt);

  var result = [
    base64urlencode(iv),
    base64urlencode(ciphertext),
    createdAt,
    duration,
    base64urlencode(hmac)
  ].join('.');

  zeroBuffer(iv);
  zeroBuffer(ciphertext);
  zeroBuffer(hmac);

  return result;
}

function decode(opts, content) {
  if (!opts.cookieName) {
    throw new Error("cookieName option required");
  }

  // stop at any time if there's an issue
  var components = content.split(".");
  if (components.length !== 5) {
    return;
  }

  setupKeys(opts);

  var iv;
  var ciphertext;
  var hmac;

  try {
    iv = base64urldecode(components[0]);
    ciphertext = base64urldecode(components[1]);
    hmac = base64urldecode(components[4]);
  } catch (ignored) {
    cleanup();
    return;
  }

  var createdAt = parseInt(components[2], 10);
  var duration = parseInt(components[3], 10);

  function cleanup() {
    if (iv) {
      zeroBuffer(iv);
    }

    if (ciphertext) {
      zeroBuffer(ciphertext);
    }

    if (hmac) {
      zeroBuffer(hmac);
    }

    if (expectedHmac) { // declared below
      zeroBuffer(expectedHmac);
    }
  }

  // make sure IV is right length
  if (iv.length !== 16) {
    cleanup();
    return;
  }

  // check hmac
  var expectedHmac = computeHmac(opts, iv, ciphertext, duration, createdAt);

  if (!constantTimeEquals(hmac, expectedHmac)) {
    cleanup();
    return;
  }

  // decrypt
  var cipher = crypto.createDecipheriv(
    opts.encryptionAlgorithm,
    opts.encryptionKey,
    iv
  );
  var plaintext = cipher.update(ciphertext, 'binary', 'utf8');
  plaintext += cipher.final('utf8');

  var cookieName = plaintext.substring(0, plaintext.indexOf(COOKIE_NAME_SEP));
  if (cookieName !== opts.cookieName) {
    cleanup();
    return;
  }

  var result;
  try {
    result = {
      content: JSON.parse(
        plaintext.substring(plaintext.indexOf(COOKIE_NAME_SEP) + 1)
      ),
      createdAt: createdAt,
      duration: duration
    };
  } catch (ignored) {
  }

  cleanup();
  return result;
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
  this.json = JSON.stringify(this._content);
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
  var secure = (res.socket && res.socket.encrypted) ||
      (req.connection && req.connection.proxySecure);
  if (opts.cookie.secure && !secure) {
    throw new Error("you cannot have a secure cookie unless the socket is " +
        " secure or you declare req.connection.proxySecure to be true.");
  }
}

Session.prototype = {
  updateDefaultExpires: function() {
    if (this.opts.cookie.maxAge) {
      return;
    }

    if (this.opts.cookie.ephemeral) {
      this.expires = null;
    } else {
      var time = this.createdAt || new Date().getTime();
      // the cookie should expire when it becomes invalid
      // we add an extra second because the conversion to a date
      // truncates the milliseconds
      this.expires = new Date(time + this.duration + 1000);
    }
  },

  clearContent: function(keysToPreserve) {
    var self = this;
    Object.keys(this._content).forEach(function(k) {
      // exclude this key if it's meant to be preserved
      if (keysToPreserve && (keysToPreserve.indexOf(k) > -1)) {
        return;
      }

      delete self._content[k];
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

  // alias for `reset` function for compatibility
  destroy: function(){
    this.reset();
  },

  setDuration: function(newDuration, ephemeral) {
    if (ephemeral && this.opts.cookie.maxAge) {
      throw new Error("you cannot have an ephemeral cookie with a maxAge.");
    }
    if (!this.loaded) {
      this.loadFromCookie(true);
    }
    this.dirty = true;
    this.duration = newDuration;
    this.createdAt = new Date().getTime();
    this.opts.cookie.ephemeral = ephemeral;
    this.updateDefaultExpires();
  },

  // take the content and do the encrypt-and-sign
  // boxing builds in the concept of createdAt
  box: function() {
    return encode(this.opts, this._content, this.duration, this.createdAt);
  },

  unbox: function(content) {
    this.clearContent();

    var unboxed = decode(this.opts, content);
    if (!unboxed) {
      return;
    }

    var self = this;


    Object.keys(unboxed.content).forEach(function(k) {
      self._content[k] = unboxed.content[k];
    });

    this.createdAt = unboxed.createdAt;
    this.duration = unboxed.duration;
    this.updateDefaultExpires();
  },

  updateCookie: function() {
    if (this.isDirty()) {
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

  loadFromCookie: function(forceReset) {
    var cookie = this.cookies.get(this.opts.cookieName);
    if (cookie) {
      this.unbox(cookie);

      var expiresAt = this.createdAt + this.duration;
      var now = Date.now();
      // should we reset this session?
      if (expiresAt < now) {
        this.reset();
      // if expiration is soon, push back a few minutes to not interrupt user
      } else if (expiresAt - now < this.activeDuration) {
        this.createdAt += this.activeDuration;
        this.dirty = true;
        this.updateDefaultExpires();
      }
    } else {
      if (forceReset) {
        this.reset();
      } else {
        return false; // didn't actually load the cookie
      }
    }

    this.loaded = true;
    this.json = JSON.stringify(this._content);
    return true;
  },

  isDirty: function() {
    return this.dirty || (this.json !== JSON.stringify(this._content));
  }

};

Object.defineProperty(Session.prototype, 'content', {
  get: function getContent() {
    if (!this.loaded) {
      this.loadFromCookie();
    }
    return this._content;
  },
  set: function setContent(value) {
    Object.defineProperty(value, 'reset', {
      enumerable: false,
      value: this.reset.bind(this)
    });
    Object.defineProperty(value, 'destroy', {
      enumerable: false,
      value: this.destroy.bind(this)
    });
    Object.defineProperty(value, 'setDuration', {
      enumerable: false,
      value: this.setDuration.bind(this)
    });
    this._content = value;
  }
});

function clientSessionFactory(opts) {
  if (!opts) {
    throw new Error("no options provided, some are required");
  }

  if (!(opts.secret || (opts.encryptionKey && opts.signatureKey))) {
    throw new Error("cannot set up sessions without a secret "+
                    "or encryptionKey/signatureKey pair");
  }

  // defaults
  opts.cookieName = opts.cookieName || "session_state";
  opts.duration = opts.duration || 24*60*60*1000;
  opts.activeDuration = 'activeDuration' in opts ?
    opts.activeDuration : ACTIVE_DURATION;

  var encAlg = opts.encryptionAlgorithm || DEFAULT_ENCRYPTION_ALGO;
  encAlg = encAlg.toLowerCase();
  if (!ENCRYPTION_ALGORITHMS[encAlg]) {
    throw new Error('invalid encryptionAlgorithm, supported are: '+
                    Object.keys(ENCRYPTION_ALGORITHMS).join(', '));
  }
  opts.encryptionAlgorithm = encAlg;

  var sigAlg = opts.signatureAlgorithm || DEFAULT_SIGNATURE_ALGO;
  sigAlg = sigAlg.toLowerCase();
  if (!SIGNATURE_ALGORITHMS[sigAlg]) {
    throw new Error('invalid signatureAlgorithm, supported are: '+
                    Object.keys(SIGNATURE_ALGORITHMS).join(', '));
  }
  opts.signatureAlgorithm = sigAlg;

  // set up cookie defaults
  opts.cookie = opts.cookie || {};
  if (typeof opts.cookie.httpOnly === 'undefined') {
    opts.cookie.httpOnly = true;
  }

  // let's not default to secure just yet,
  // as this depends on the socket being secure,
  // which is tricky to determine if proxied.
  /*
  if (typeof(opts.cookie.secure) == 'undefined')
    opts.cookie.secure = true;
    */

  setupKeys(opts);
  keyConstraints(opts);

  const propertyName = opts.requestKey || opts.cookieName;

  return function clientSession(req, res, next) {
    if (propertyName in req) {
      return next(); //self aware
    }

    var cookies = new Cookies(req, res);
    var rawSession;
    try {
      rawSession = new Session(req, res, cookies, opts);
    } catch (x) {
      // this happens only if there's a big problem
      process.nextTick(function() {
        next("client-sessions error: " + x.toString());
      });
      return;
    }

    Object.defineProperty(req, propertyName, {
      get: function getSession() {
        return rawSession.content;
      },
      set: function setSession(value) {
        if (isObject(value)) {
          rawSession.content = value;
        } else {
          throw new TypeError("cannot set client-session to non-object");
        }
      }
    });


    var writeHead = res.writeHead;
    res.writeHead = function () {
      rawSession.updateCookie();
      return writeHead.apply(res, arguments);
    };

    next();
  };
}

module.exports = clientSessionFactory;


// Expose encode and decode method

module.exports.util = {
  encode: encode,
  decode: decode,
  computeHmac: computeHmac
};
