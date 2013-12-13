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
    secure: false   // when true, cookie will only be sent over SSL
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
  secret: 'blargadeeblargblarg', // should be a large unguessable string
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

## License

> This Source Code Form is subject to the terms of the Mozilla Public
> License, v. 2.0. If a copy of the MPL was not distributed with this
> file, You can obtain one at http://mozilla.org/MPL/2.0/.
