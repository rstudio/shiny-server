[![build status](https://secure.travis-ci.org/mozilla/node-client-sessions.png)](http://travis-ci.org/mozilla/node-client-sessions)

client-sessions is connect middleware that implements sessions in encrypted tamper-free cookies.  For a complete introduction to encrypted client side sessions, refer to [Francois Marier's blog post on the subject][];

[Francois Marier's blog post on the subject]: https://hacks.mozilla.org/2012/12/using-secure-client-side-sessions-to-build-simple-and-scalable-node-js-applications-a-node-js-holiday-season-part-3/

**NOTE:** It is not recommended using both this middleware and connect's built-in session middleware.

## Usage

Basic usage:

```js
var sessions = require("client-sessions");
app.use(sessions({
  cookieName: 'mySession', // cookie name dictates the key name added to the request object
  secret: 'blargadeeblargblarg', // should be a large unguessable string
  duration: 24 * 60 * 60 * 1000, // how long the session will stay valid in ms
  activeDuration: 1000 * 60 * 5 // if expiresIn < activeDuration, the session will be extended by activeDuration milliseconds
}));

app.use(function(req, res, next) {
  if (req.mySession.seenyou) {
    res.setHeader('X-Seen-You', 'true');
  } else {
    // setting a property will automatically cause a Set-Cookie response
    // to be sent
    req.mySession.seenyou = true;
    res.setHeader('X-Seen-You', 'false');
  }
});
```

You can control more specific cookie behavior during setup:

```js
app.use(sessions({
  cookieName: 'mySession', // cookie name dictates the key name added to the request object
  secret: 'blargadeeblargblarg', // should be a large unguessable string
  duration: 24 * 60 * 60 * 1000, // how long the session will stay valid in ms
  cookie: {
    path: '/api', // cookie will only be sent to requests under '/api'
    maxAge: 60000, // duration of the cookie in milliseconds, defaults to duration above
    ephemeral: false, // when true, cookie expires when the browser closes
    httpOnly: true, // when true, cookie is not accessible from javascript
    secure: false // when true, cookie will only be sent over SSL. use key 'secureProxy' instead if you handle SSL not in your node process
  }
}));
```

You can have multiple cookies:

```js
// a 1 week session
app.use(sessions({
  cookieName: 'shopping_cart',
  secret: 'first secret',
  duration: 7 * 24 * 60 * 60 * 1000
}));

// a 2 hour encrypted session
app.use(sessions({
  cookieName: 'authenticated',
  secret: 'first secret',
  duration: 2 * 60 * 60 * 1000
}));
```

In this example, there's a 2 hour authentication session, but shopping carts persist for a week.

Finally, you can use requestKey to force the name where information can be accessed on the request object.

```js
var sessions = require("client-sessions");
app.use(sessions({
  cookieName: 'mySession',
  requestKey: 'forcedSessionKey', // requestKey overrides cookieName for the key name added to the request object.
  secret: 'blargadeeblargblarg', // should be a large unguessable string or Buffer
  duration: 24 * 60 * 60 * 1000, // how long the session will stay valid in ms
}));

app.use(function(req, res, next) {
  // requestKey forces the session information to be
  // accessed via forcedSessionKey
  if (req.forcedSessionKey.seenyou) {
    res.setHeader('X-Seen-You', 'true');
  }
  next();
});
```

## Cryptography

A pair of encryption and signature keys are derived from the `secret` option
via HMAC-SHA-256; the `secret` isn't used directly to encrypt or compute the
MAC.

The key-derivation function, in pseudocode:

```text
  encKey := HMAC-SHA-256(secret, 'cookiesession-encryption');
  sigKey := HMAC-SHA-256(secret, 'cookiesession-signature');
```

The **AES-256-CBC** cipher is used to encrypt the session contents, with an
**HMAC-SHA-256** authentication tag (via **Encrypt-then-Mac** composition).  A
random 128-bit Initialization Vector (IV) is generated for each encryption
operation (this is the AES block size regardless of the key size).  The
CBC-mode input is padded with the usual PKCS#5 scheme.

In pseudocode, the encryption looks like the following, with `||` denoting
concatenation. The `createdAt` and `duration` parameters are decimal strings.

```text
  iv := secureRandom(16 bytes)
  ciphertext := AES-256-CBC(encKey, iv, sessionJson)
  payload := iv || '.' || ciphertext || '.' || createdAt || '.' || duration
  hmac := HMAC-SHA-256(sigKey, payload)
  cookie := base64url(iv) || '.' ||
    base64url(ciphertext) || '.' ||
    createdAt || '.' ||
    duration || '.' ||
    base64url(hmac)
```

For decryption, a constant-time equality operation is used to verify the HMAC
output to avoid the plausible timing attack.

### Advanced Cryptographic Options

The defaults are secure, but may not suit your requirements. Some example scenarios:
- You want to use randomly-generated keys instead of using the key-derivation
  function used in this module.
- AES-256 is overkill for the type of data you store in the session (e.g. not
  personally-identifiable or sensitive) and you'd like to trade-off decreasing
  the security level for CPU economy.
- SHA-256 is maybe too weak for your application and you want to have more
  MAC security by using SHA-512, which grows the size of your cookies slightly.

If the defaults don't suit your needs, you can customize client-sessions.
**Beware: Changing keys and/or algorithms will make previously-generated
Cookies invalid!**

#### Configuring Keys

To configure independent encryption and signature (HMAC) keys:

```js
app.use(sessions({
  encryptionKey: loadFromKeyStore('session-encryption-key'),
  signatureKey: loadFromKeyStore('session-signature-key'),
  // ... other options discussed above ...
}));
```

#### Configuring Algorithms

To specify custom algorithms and keys:

```js
app.use(sessions({
  // use WEAKER-than-default encryption:
  encryptionAlgorithm: 'aes128',
  encryptionKey: loadFromKeyStore('session-encryption-key'),
  // use a SHORTER-than-default MAC:
  signatureAlgorithm: 'sha256-drop128',
  signatureKey: loadFromKeyStore('session-signature-key'),
  // ... other options discussed above ...
}));
```

#### Encryption Algorithms

Supported CBC-mode `encryptionAlgorithm`s (and key length requirements):

| Cipher | Key length |
| ------ | ---------- |
| aes128 | 16 bytes   |
| aes192 | 24 bytes   |
| aes256 | 32 bytes   |

These key lengths are exactly as required by the [Advanced Encryption
Standard](https://en.wikipedia.org/wiki/Advanced_Encryption_Standard).

#### Signature (HMAC) Algorithms

Supported HMAC `signatureAlgorithm`s (and key length requirements):

| HMAC           | Minimum Key Length | Maximum Key Length |
| -------------- | ------------------ | ------------------ |
| sha256         | 32 bytes           | 64 bytes           |
| sha256-drop128 | 32 bytes           | 64 bytes           |
| sha384         | 48 bytes           | 128 bytes          |
| sha384-drop192 | 48 bytes           | 128 bytes          |
| sha512         | 64 bytes           | 128 bytes          |
| sha512-drop256 | 64 bytes           | 128 bytes          |

The HMAC key length requirements are derived from [RFC 2104 section
3](https://tools.ietf.org/html/rfc2104#section-3). The maximum key length can
be exceeded, but it doesn't increase the security of the signature.

The `-dropN` algorithms discard the latter half of the HMAC output, which
provides some additional protection against SHA2 length-extension attacks on
top of HMAC. The same technique is used in the upcoming [JSON Web Algorithms
`AES_CBC_HMAC_SHA2` authenticated
cipher](http://tools.ietf.org/html/draft-ietf-jose-json-web-algorithms-19#section-5.2).

#### Generating Keys

One can easily generate both AES and HMAC-SHA2 keys via command line: `openssl
rand -base64 32` for a 32-byte (256-bit) key.  It's easy to then parse that
output into a `Buffer`:

```js
function loadKeyFromStore(name) {
  var text = myConfig.keys[name];
  return new Buffer(text, 'base64');
}
```

#### Key Constraints

If you specify `encryptionKey` or `signatureKey`, you must supply the other as
well.

The following constraints must be met or an `Error` will be thrown:

1. both keys must be `Buffer`s.
2. the keys must be _different_.
3. the encryption key are _exactly_ the length required (see above).
4. the signature key has _at least_ the length required (see above).

Based on the above, please note that if you specify a `secret` _and_ a
`signatureAlgorithm`, you need to use `sha256` or `sha256-drop128`.

## License

> This Source Code Form is subject to the terms of the Mozilla Public
> License, v. 2.0. If a copy of the MPL was not distributed with this
> file, You can obtain one at http://mozilla.org/MPL/2.0/.
