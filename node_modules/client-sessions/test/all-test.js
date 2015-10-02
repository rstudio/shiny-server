// a NODE_ENV of test will supress console output to stderr which
// connect likes to do when next() is called with a non-falsey error
// message.  We test such codepaths here.
process.env.NODE_ENV = 'test';

var vows = require("vows"),
    assert = require("assert"),
    cookieSessions = require("../lib/client-sessions"),
    express = require("express"),
    tobi = require("tobi"),
    Browser = require("zombie");

function create_app() {
  // set up the session middleware
  // XXX: same secret is important for a test
  var middleware = cookieSessions({
    cookieName: 'session',
    secret: 'yo',
    activeDuration: 0,
    cookie: {
      maxAge: 5000
    }
  });

  var app = express.createServer();
  app.use(middleware);

  // set up a second cookie storage middleware
  var secureStoreMiddleware = cookieSessions({
    cookieName: 'securestore',
    secret: 'yo',
    activeDuration: 0,
    cookie: {
      maxAge: 5000
    }
  });

  app.use(secureStoreMiddleware);

  return app;
}

var suite = vows.describe('all');

suite.addBatch({
  "middleware" : {
    topic: function() {
      var self = this;
      var middleware = cookieSessions({
        cookieName: 'session',
        secret: 'yo',
        activeDuration: 0,
        cookie: {
          maxAge: 5000
        }
      });

      var req = {
        headers: {}
      };
      var res = {};

      middleware(req, res, function(err) {
        self.callback(err, req, res);
      });
    },
    "includes a session object": function(err, req) {
      assert.isObject(req.session);
    },
    "session object stores and retrieves values properly": function(err, req) {
      req.session.foo = 'bar';
      assert.equal(req.session.foo, 'bar');
    },
    "session object has reset function": function(err, req) {
      assert.isFunction(req.session.reset);
    },
    "session object has setDuration function": function(err, req) {
      assert.isFunction(req.session.setDuration);
    },
    "set variables and clear them yields no variables": function(err, req) {
      req.session.bar = 'baz';
      req.session.reset();
      assert.isUndefined(req.session.bar);
    },
    "set variables does the right thing for Object.keys": function(err, req) {
      req.session.reset();
      req.session.foo = 'foobar';
      assert.equal(Object.keys(req.session).length, 1);
      assert.equal(Object.keys(req.session)[0], 'foo');
    },
    "reset preserves variables when asked": function(err, req) {
      req.session.reset();
      req.session.foo = 'foobar';
      req.session.bar = 'foobar2';

      req.session.reset(['foo']);

      assert.isUndefined(req.session.bar);
      assert.equal(req.session.foo, 'foobar');
    },
    "set session property absorbs set object": function(err, req) {
      req.session.reset();
      req.session.foo = 'quux';

      req.session = { bar: 'baz' };

      assert.isUndefined(req.session.foo);
      assert.isFunction(req.session.reset);
      assert.isFunction(req.session.setDuration);
      assert.equal(req.session.bar, 'baz');

      assert.throws(function() {
        req.session = 'blah';
      }, TypeError);
    }
  }
});

suite.addBatch({
  "a single request object" : {
    topic: function() {
      var self = this;

      // simple app
      var app = create_app();

      app.get("/foo", function(req, res) {
        req.session.foo = 'foobar';
        res.send("hello");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        self.callback(null, res);
      });
    },
    "includes a set-cookie header": function(err, res) {
      assert.isArray(res.headers['set-cookie']);
    },
    "only one set-cookie header": function(err, res) {
      assert.equal(res.headers['set-cookie'].length, 1);
    },
    "with an expires attribute": function(err, res) {
      assert.match(res.headers['set-cookie'][0], /expires/);
    },
    "with a path attribute": function(err, res) {
      assert.match(res.headers['set-cookie'][0], /path/);
    },
    "with an httpOnly attribute": function(err, res) {
      assert.match(res.headers['set-cookie'][0], /httponly/);
    }
  }
});

suite.addBatch({
  "across two requests" : {
    topic: function() {
      var self = this;

      // simple app
      var app = create_app();

      app.get("/foo", function(req, res) {
        req.session.reset();
        req.session.foo = 'foobar';
        req.session.bar = [1, 2, 3];
        res.send("foo");
      });

      app.get("/bar", function(req, res) {
        self.callback(null, req);
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        browser.get("/bar", function(res, $) {
        });
      });
    },
    "session maintains state": function(err, req) {
      assert.equal(req.session.foo, 'foobar');
      assert.equal(req.session.bar.length, 3);
      assert.equal(req.session.bar[0], 1);
      assert.equal(req.session.bar[1], 2);
      assert.equal(req.session.bar[2], 3);
    }
  }
});

suite.addBatch({
  "across two requests" : {
    topic: function() {
      var self = this;

      // simple app
      var app = create_app();

      app.get("/foo", function(req, res) {
        req.session.reset();
        req.session.foo = 'foobar';
        res.send("foo");
      });

      app.get("/bar", function(req, res) {
        self.callback(null, req);
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        browser.get("/bar", function(res, $) {
        });
      });
    },
    "resetting a session with an existing cookie value yields no variables": function(err, req) {
      req.session.reset();
      assert.isUndefined(req.session.foo);
    }
  }
});

suite.addBatch({
  "across three requests" : {
    topic: function() {
      var self = this;

      // simple app
      var app = create_app();

      app.get("/foo", function(req, res) {
        req.session.reset();
        req.session.foo = 'foobar';
        req.session.bar = 'foobar2';
        res.send("foo");
      });

      app.get("/bar", function(req, res) {
        delete req.session.bar;
        res.send("bar");
      });

      app.get("/baz", function(req, res) {
        self.callback(null, req);
        res.send("baz");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        browser.get("/bar", function(res, $) {
          browser.get("/baz", function(res, $) {
          });
        });
      });
    },
    "session maintains state": function(err, req) {
      assert.equal(req.session.foo, 'foobar');
      assert.isUndefined(req.session.bar);
    }
  },
  "across three requests with deep objects" : {
    topic: function() {
      var self = this;

      // simple app
      var app = create_app();

      app.get("/foo", function(req, res) {
        req.session.reset();
        req.session.foo = 'foobar';
        req.session.bar = { a: 'b' };
        res.send("foo");
      });

      app.get("/bar", function(req, res) {
        req.session.bar.c = 'd';
        res.send("bar");
      });

      app.get("/baz", function(req, res) {
        self.callback(null, req);
        res.send("baz");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        browser.get("/bar", function(res, $) {
          browser.get("/baz", function(res, $) {
          });
        });
      });
    },
    "session maintains state": function(err, req) {
      assert.equal(req.session.foo, 'foobar');
      assert.equal(req.session.bar.c, 'd');
    }
  }
});

suite.addBatch({
  "reading from an existing session" : {
    topic: function() {
      var self = this;

      // simple app
      var app = create_app();

      app.get("/foo", function(req, res) {
        req.session.foo = 'foobar';
        res.send("foo");
      });

      app.get("/bar", function(req, res) {
        res.send(req.session.foo);
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        browser.get("/bar", function(res, $) {
          // observe the response to the second request
          self.callback(null, res);
        });
      });
    },
    "does not set a cookie": function(err, res) {
      assert.isUndefined(res.headers['set-cookie']);
    }
  },
  "reading from a non-existing session" : {
    topic: function() {
      var self = this;

      // simple app
      var app = create_app();

      app.get("/foo", function(req, res) {
        // this should send undefined, not null
        res.send(req.session.foo);
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        self.callback(null, res, $);
      });
    },
    "does not set a cookie": function(err, res, body) {
      assert.isUndefined(res.headers['set-cookie']);
      assert.isUndefined(body);
    }
  }
});

suite.addBatch({
  "writing to a session" : {
    topic: function() {
      var self = this;

      // simple app
      var app = create_app();

      app.get("/foo", function(req, res) {
        req.session.foo = 'foobar';
        res.send("foo");
      });

      app.get("/bar", function(req, res) {
        req.session.reset();
        req.session.reset();
        req.session.bar = 'bar';
        req.session.baz = 'baz';
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        browser.get("/bar", function(res, $) {
          // observe the response to the second request
          self.callback(null, res);
        });
      });
    },
    "sets a cookie": function(err, res) {
      assert.isArray(res.headers['set-cookie']);
    },
    "and only one cookie": function(err, res) {
      assert.equal(res.headers['set-cookie'].length, 1);
    }
  }
});

function create_app_with_duration() {
  // simple app
  var app = express.createServer();
  app.use(cookieSessions({
    cookieName: 'session',
    secret: 'yo',
    activeDuration: 0,
    duration: 500 // 0.5 seconds
  }));

  app.get("/foo", function(req, res) {
    req.session.reset();
    req.session.foo = 'foobar';
    res.send("foo");
  });

  return app;
}

suite.addBatch({
  "querying within duration" : {
    topic: function() {
      var self = this;

      var app = create_app_with_duration();
      app.get("/bar", function(req, res) {
        self.callback(null, req);
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        setTimeout(function () {
          browser.get("/bar", function(res, $) {
          });
        }, 200);
      });
    },
    "session still has state": function(err, req) {
      assert.equal(req.session.foo, 'foobar');
    }
  }
});

suite.addBatch({
  "modifying the session": {
    topic: function() {
      var self = this;

      var app = create_app_with_duration();
      app.get("/bar", function(req, res) {
        self.callback(null, req);
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      var firstCreatedAt, secondCreatedAt;
      browser.get("/foo", function(res, $) {
        browser.get("/bar", function(res, $) {
        });
      });
    },
    "doesn't change createdAt": function(err, req) {
      assert.equal(req.session.foo, 'foobar');
    }
  }
});

suite.addBatch({
  "querying outside the duration time": {
    topic: function() {
      var self = this;

      var app = create_app_with_duration();
      app.get("/bar", function(req, res) {
        self.callback(null, req);
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        setTimeout(function () {
          browser.get("/bar", function(res, $) {
          });
        }, 800);
      });
    },
    "session no longer has state": function(err, req) {
      assert.isUndefined(req.session.foo);
    }
  }
});

suite.addBatch({
  "querying twice, each at 2/5 duration time": {
    topic: function() {
      var self = this;

      var app = create_app_with_duration();
      app.get("/bar", function(req, res) {
        req.session.baz = Math.random();
        res.send("bar");
      });

      app.get("/bar2", function(req, res) {
        self.callback(null, req);
        res.send("bar2");
      });

      var browser = tobi.createBrowser(app);
      // first query resets the session to full duration
      browser.get("/foo", function(res, $) {
        setTimeout(function () {
          // this query should NOT reset the session
          browser.get("/bar", function(res, $) {
            setTimeout(function () {
              // so the session should still be valid
              browser.get("/bar2", function(res, $) {
              });
            }, 200);
          });
        }, 200);
      });
    },
    "session still has state": function(err, req) {
      assert.isDefined(req.session.baz);
    }
  }
});

suite.addBatch({
  "querying twice, each at 3/5 duration time": {
    topic: function() {
      var self = this;

      var app = create_app_with_duration();
      app.get("/bar", function(req, res) {
        req.session.baz = Math.random();
        res.send("bar");
      });

      app.get("/bar2", function(req, res) {
        self.callback(null, req);
        res.send("bar2");
      });

      var browser = tobi.createBrowser(app);
      // first query resets the session to full duration
      browser.get("/foo", function(res, $) {
        setTimeout(function () {
          // this query should NOT reset the session
          browser.get("/bar", function(res, $) {
            setTimeout(function () {
              // so the session should be dead by now
              browser.get("/bar2", function(res, $) {
              });
            }, 300);
          });
        }, 300);
      });
    },
    "session no longer has state": function(err, req) {
      assert.isUndefined(req.session.baz);
    }
  }
});

function create_app_with_duration_modification() {
  // simple app
  var app = express.createServer();

  app.use(cookieSessions({
    cookieName: 'session',
    secret: 'yobaby',
    activeDuration: 0,
    duration: 5000 // 5.0 seconds
  }));

  app.get("/create", function(req, res) {
    req.session.foo = "foo";
    res.send("created");
  });

  app.get("/augment", function(req, res) {
    req.session.bar = "bar";
    res.send("augmented");
  });

  // invoking this will change the session duration to 500ms
  app.get("/change", function(req, res) {
    req.session.setDuration(500);
    res.send("duration changed");
  });


  return app;
}

suite.addBatch({
  "after changing cookie duration and querying outside the modified duration": {
    topic: function() {
      var self = this;

      var app = create_app_with_duration_modification();
      app.get("/complete", function(req, res) {
        self.callback(null, req);
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/create", function(res, $) {
        browser.get("/change", function(res, $) {
          setTimeout(function () {
            browser.get("/complete", function(res, $) { });
          }, 700);
        });
      });
    },
    "session no longer has state": function(err, req) {
      assert.isUndefined(req.session.foo);
    }
  }
});

var initialCookie;
var updatedCookie;

suite.addBatch({
  "changing duration": {
    topic: function() {
      var self = this;

      var app = create_app_with_duration_modification();
      app.get("/complete", function(req, res) {
        self.callback(null, req);
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/create", function(res, $) {
        initialCookie = browser.cookieJar.cookies[0].value;
        browser.get("/change", function(res, $) {
          updatedCookie = browser.cookieJar.cookies[0].value;
          browser.get("/complete", function(res, $) { });
        });
      });
    },
    "doesn't affect session variables": function(err, req) {
      assert.equal(req.session.foo, "foo");
    },
    "does update creation time": function(err, req) {
      assert.notEqual(initialCookie.split('.')[2],
                      updatedCookie.split('.')[2],
                      "after duration update, creation should be updated");
    },
    "does update duration": function(err, req) {
      assert.strictEqual(parseInt(initialCookie.split('.')[3], 10), 5000);
      assert.strictEqual(parseInt(updatedCookie.split('.')[3], 10), 500);
    }
  }
});

suite.addBatch({
  "after changing duration then setting a new session variable": {
    topic: function() {
      var self = this;

      var app = create_app_with_duration_modification();
      app.get("/set_then_duration", function(req, res) {
        req.session.baz = "baz";
        req.session.setDuration(500);
        res.send("did it");
      });


      app.get("/complete", function(req, res) {
        self.callback(null, req);
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/create", function(res, $) {
        browser.get("/set_then_duration", function(res, $) {
          browser.get("/complete", function(res, $) { });
        });
      });
    },
    "variable is visible": function(err, req) {
      assert.equal(req.session.foo, "foo");
      assert.equal(req.session.baz, "baz");
    }
  }
});

suite.addBatch({
  "after setting a new session variable then changing duration": {
    topic: function() {
      var self = this;

      var app = create_app_with_duration_modification();
      app.get("/set_then_duration", function(req, res) {
        req.session.setDuration(500);
        req.session.baz = "baz";
        res.send("did it");
      });


      app.get("/complete", function(req, res) {
        self.callback(null, req);
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/create", function(res, $) {
        browser.get("/set_then_duration", function(res, $) {
          browser.get("/complete", function(res, $) { });
        });
      });
    },
    "variable is visible": function(err, req) {
      assert.equal(req.session.foo, "foo");
      assert.equal(req.session.baz, "baz");
    }
  }
});

suite.addBatch({
  "setting new variables then invoking setDuration": {
    topic: function() {
      var self = this;

      var app = create_app_with_duration_modification();
      app.get("/complete", function(req, res) {
        self.callback(null, req);
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/create", function(res, $) {
        browser.get("/change", function(res, $) {
          browser.get("/augment", function(res, $) {
            browser.get("/complete", function(res, $) { });
          });
        });
      });
    },
    "both variables are visible": function(err, req) {
      assert.equal(req.session.foo, "foo");
      assert.equal(req.session.bar, "bar");
    }
  }
});

function create_app_with_secure(firstMiddleware) {
  // set up the session middleware
  var middleware = cookieSessions({
    cookieName: 'session',
    secret: 'yo',
    activeDuration: 0,
    cookie: {
      maxAge: 5000,
      secure: true
    }
  });

  var app = express.createServer();
  if (firstMiddleware)
    app.use(firstMiddleware);

  app.use(middleware);

  return app;
}

suite.addBatch({
  "across two requests, without proxySecure, secure cookies" : {
    topic: function() {
      var self = this;

      var app = create_app_with_secure();

      app.get("/foo", function(req, res) {
        res.send("foo");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        self.callback(null, res);
      });
    },
    "cannot be set": function(err, res) {
      assert.equal(res.statusCode, 500);
    }
  }
});

suite.addBatch({
  "across two requests, with proxySecure, secure cookies" : {
    topic: function() {
      var self = this;

      var app = create_app_with_secure(function(req, res, next) {
        // say it is proxySecure
        req.connection.proxySecure = true;
        next();
      });

      app.get("/foo", function(req, res) {
        res.send("foo");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        self.callback(null, res);
      });

    },
    "can be set": function(err, res) {
      assert.equal(res.statusCode, 200);
    }
  }
});


suite.addBatch({
  "public encode and decode util methods" : {
    topic: function() {
      var self = this;

      var app = create_app();
      app.get("/foo", function(req, res) {
        self.callback(null, req);
        res.send("hello");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {});
    },
    "encode " : function(err, req){
      var result = cookieSessions.util.encode({cookieName: 'session', secret: 'yo'}, {foo:'bar'});
      var result_arr = result.split(".");
      assert.equal(result_arr.length, 5);
    },
    "encode and decode - is object" : function(err, req){
      var encoded = cookieSessions.util.encode({cookieName: 'session', secret: 'yo'}, {foo:'bar'});
      var decoded = cookieSessions.util.decode({cookieName: 'session', secret: 'yo'}, encoded);
      assert.isObject(decoded);
    },
    "encode and decode - has all values" : function(err, req){
      var encoded = cookieSessions.util.encode({cookieName: 'session', secret: 'yo'}, {foo:'bar', bar:'foo'});
      var decoded = cookieSessions.util.decode({cookieName: 'session', secret: 'yo'}, encoded);
      assert.equal(decoded.content.foo, 'bar');
      assert.equal(decoded.content.bar, 'foo');
      assert.isNumber(decoded.duration);
      assert.isNumber(decoded.createdAt);
    },
    "encode and decode - override duration and createdAt" : function(err, req){
      var encoded = cookieSessions.util.encode({cookieName: 'session', secret: 'yo'}, {foo:'bar', bar:'foo'}, 5000, 1355408039221);
      var decoded = cookieSessions.util.decode({cookieName: 'session', secret: 'yo'}, encoded);
      assert.equal(decoded.duration, 5000);
      assert.equal(decoded.createdAt, 1355408039221);
    },
    "encode and decode - default duration" : function(err, req){
      var encoded = cookieSessions.util.encode({cookieName: 'session', secret: 'yo'}, {foo:'bar'});
      var decoded = cookieSessions.util.decode({cookieName: 'session', secret: 'yo'}, encoded);
      assert.equal(decoded.duration, 86400000);
    },
    "encode and decode - tampered HMAC" : function(err, req){
      var encodedReal = 'LVB3G2lnPF75RzsT9mz7jQ.RT1Lcq0dOJ_DMRHyWJ4NZPjBXr2WzkFcUC4NO78gbCQ.1371704898483.5000.ILEusgnajT1sqCWLuzaUt-HFn2KPjYNd38DhI7aRCb9';
      var encodedFake = encodedReal.substring(0, encodedReal.length - 1) + 'A';

      var decodedReal = cookieSessions.util.decode({cookieName: 'session', secret: 'yo'}, encodedReal);
      assert.isObject(decodedReal);
      var decodedFake = cookieSessions.util.decode({cookieName: 'session', secret: 'yo'}, encodedFake);
      assert.isUndefined(decodedFake);
    },
    "decode - invalid input" : function(err, req){
        var notEnoughComponents = 'LVB3G2lnPF75RzsT9mz7jQ.RT1Lcq0dOJ_DMRHyWJ4NZPjBXr2WzkFcUC4NO78gbCQ.1371704898483.5000';
        assert.isUndefined(cookieSessions.util.decode({cookieName: 'session', secret: 'yo'}, notEnoughComponents));

        var invalidBase64 = 'LVB3G2lnPF75RzsT9mz7jQ.RT1Lcq0dOJ_DMRHyWJ4NZPjBXr2WzkFcUC4NO78gb.1371704898483.5000.ILEusgnajT1sqCWLuzaUt-HFn2KPjYNd38DhI7aRCb9';
        assert.isUndefined(cookieSessions.util.decode({cookieName: 'session', secret: 'yo'}, invalidBase64));
    }
  }
});

suite.addBatch({
  "two middlewares": {
    topic: function() {
      var self = this;

      var app = create_app();
      app.get("/foo", function(req, res) {
        self.callback(null, req);
        res.send("hello");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $){});
    },
    "We can write to both stores": function(err, req) {
      req.session.foo = 'bar';
      req.securestore.foo = 'buzz';
      req.securestore.widget = 4;

      assert.equal(req.session.foo, 'bar');
      assert.equal(req.securestore.foo, 'buzz');
      assert.equal(req.securestore.widget, 4);
    }
  }
});

suite.addBatch({
  "specifying requestKey different than cookieName": {
    topic: function() {
      var self = this;

      var app = express.createServer();
      app.use(cookieSessions({
        cookieName: 'ooga_booga_momma',
        activeDuration: 0,
        requestKey: 'ses',
        secret: 'yo'
      }));

      app.get('/foo', function(req, res) {
        self.callback(null, req);
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $){});
    },
    "session is defined as req[requestKey]": function(err, req) {
      assert.isObject(req.ses);
      assert.strictEqual(Object.keys(req.ses).length, 0);
      assert.isUndefined(req.session);
      assert.isUndefined(req.ooga_booga_momma);
    }
  }
});

suite.addBatch({
  "swapping two cookies": {
    topic: function() {
      var self = this;
      var app = create_app(); //important that they use the same secret
      app.get('/foo', function(req, res) {
        req.session.foo = 'bar';
        req.securestore.foo = 'buzz';
        req.securestore.widget = 4;
        res.send('hello');
      });
      app.get('/bar', function(req, res) {
        self.callback(null, req);
        res.send('bye');
      });

      tobi.createBrowser(app).get('/foo', function(res, $){
        var cookies = res.headers['set-cookie'];
        var firstCookie = cookies[0];
        var secondCookie = cookies[1];

        function getCookieName(cookieHeader) {
          return cookieHeader.substring(0, cookieHeader.indexOf('='));
        }

        function getCookieValue(cookieHeader) {
          return cookieHeader.substring(cookieHeader.indexOf('='), cookieHeader.indexOf(';'));
        }

        var firstHijack = getCookieName(firstCookie) + getCookieValue(secondCookie);
        var secondHijack = getCookieName(secondCookie) + getCookieValue(firstCookie);

        // new browser, because tobi overwrites the passed cookies
        // header with its cookie jar, so we need a new jar
        tobi.createBrowser(app).get('/bar', {
            headers: { 'Cookie': firstHijack + '; ' + secondHijack } 
        }, function(res, $){});

      });
    },
    "doesn't keep using cookie": function(err, req) {
      // session.foo should not be what securestore.foo was, or else
      // we swapped cookies!
      assert.notEqual(req.session.foo, 'buzz');
      assert.notEqual(req.session.widget, 4);
      assert.notEqual(req.securestore.foo, 'bar');
    }
  }
});

suite.addBatch({
  "missing cookie maxAge": {
    topic: function() {
      var self = this;

      var app = express.createServer();
      app.use(cookieSessions({
        cookieName: 'session',
        duration: 50000,
        activeDuration: 0,
        secret: 'yo'
      }));

      app.get("/foo", function(req, res) {
        req.session.foo = 'foobar';
        res.send("hello");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        self.callback(null, res);
      });
    },
    "still has an expires attribute": function(err, res) {
      assert.match(res.headers['set-cookie'][0], /expires/, "cookie is a session cookie");
    },
    "which roughly matches the session duration": function(err, res) {
      var expiryValue = res.headers['set-cookie'][0].replace(/^.*expires=([^;]+);.*$/, "$1");
      var expiryDate = new Date(expiryValue);
      var cookieDuration = expiryDate.getTime() - Date.now();
      assert(Math.abs(50000 - cookieDuration) < 1500, "expiry is pretty far from the specified duration");
    }
  },
  "changing the duration": {
    topic: function() {
      var self = this;

      var app = express.createServer();
      app.use(cookieSessions({
        cookieName: 'session',
        duration: 500,
        activeDuration: 0,
        secret: 'yo'
      }));

      app.get("/foo", function(req, res) {
        req.session.foo = 'foobar';
        res.send("hello");
      });

      app.get("/bar", function(req, res) {
        req.session.setDuration(5000);
        res.send("bar");
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function(res, $) {
        setTimeout(function () {
          browser.get("/bar", function(res, $) {
            self.callback(null, res);
          });
        }, 200);
      });
    },
    "updates the cookie expiry": function(err, res) {
      var expiryValue = res.headers['set-cookie'][0].replace(/^.*expires=([^;]+);.*$/, "$1");
      var expiryDate = new Date(expiryValue);
      var cookieDuration = expiryDate.getTime() - Date.now();
      assert(Math.abs(cookieDuration - 5000) < 1000, "expiry is pretty far from the specified duration");
    }
  },
  "active user with session close to expiration": {
    topic: function() {
      var app = express.createServer();
      var self = this;
      app.use(cookieSessions({
        cookieName: 'session',
        duration: 300,
        activeDuration: 500,
        secret: 'yo'
      }));

      app.get("/foo", function(req, res) {
        req.session.foo = 'foobar';
        res.send("hello");
      });

      app.get("/bar", function(req, res) {
        req.session.bar = 'baz';
        res.send('hi');
      });

      app.get("/baz", function(req, res) {
        res.json({ "msg": req.session.foo + req.session.bar });
      });

      var browser = tobi.createBrowser(app);
      browser.get("/foo", function() {
        browser.get("/bar", function() {
          setTimeout(function () {
            browser.get("/baz", function(res, first) {
              setTimeout(function() {
                browser.get('/baz', function(res, second) {
                  self.callback(null, first, second);
                });
              }, 1000);
            });
          }, 400);
        });
      });

    },
    "extends session duration": function(err, extended, tooLate) {
      assert.equal(extended.msg, 'foobarbaz');
      assert.equal(tooLate.msg, null);
    }
  }
});

var shared_browser1;
var shared_browser2;

suite.addBatch({
  "non-ephemeral cookie": {
    topic: function() {
      var self = this;

      var app = express.createServer();
      app.use(cookieSessions({
        cookieName: 'session',
        duration: 5000,
        secret: 'yo',
        cookie: {
          ephemeral: false
        }
      }));

      app.get("/foo", function(req, res) {
        req.session.foo = 'foobar';
        res.send("hello");
      });

      app.get("/bar", function(req, res) {
        req.session.setDuration(6000, true);
        res.send("hello");
      });

      shared_browser1 = tobi.createBrowser(app);
      shared_browser1.get("/foo", function(res, $) {
        self.callback(null, res);
      });
    },
    "has an expires attribute": function(err, res) {
      assert.match(res.headers['set-cookie'][0], /expires/, "cookie is a session cookie");
    },
    "changing to an ephemeral one": {
      topic: function() {
        var self = this;
        shared_browser1.get("/bar", function(res, $) {
          self.callback(null, res);
        });
      },
      "removes its expires attribute": function(err, res) {
        assert.strictEqual(res.headers['set-cookie'][0].indexOf('expires='), -1, "cookie is not ephemeral");
      }
    }
  },
  "ephemeral cookie": {
    topic: function() {
      var self = this;

      var app = express.createServer();
      app.use(cookieSessions({
        cookieName: 'session',
        duration: 50000,
        activeDuration: 0,
        secret: 'yo',
        cookie: {
          ephemeral: true
        }
      }));

      app.get("/foo", function(req, res) {
        req.session.foo = 'foobar';
        res.send("hello");
      });

      app.get("/bar", function(req, res) {
        req.session.setDuration(6000, false);
        res.send("hello");
      });

      shared_browser2 = tobi.createBrowser(app);
      shared_browser2.get("/foo", function(res, $) {
        self.callback(null, res);
      });
    },
    "doesn't have an expires attribute": function(err, res) {
      assert.strictEqual(res.headers['set-cookie'][0].indexOf('expires='), -1, "cookie is not ephemeral");
    },
    "changing to an non-ephemeral one": {
      topic: function() {
        var self = this;
        shared_browser2.get("/bar", function(res, $) {
          self.callback(null, res);
        });
      },
      "gains an expires attribute": function(err, res) {
        assert.match(res.headers['set-cookie'][0], /expires/, "cookie is a session cookie");
      }
    }
  }
});

var sixtyFourByteKey = new Buffer(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'binary'
);
var HMAC_EXPECT = {
  // aligned so you can see the dropN effect:
  'sha256':
    'PRYaxV/8RkMyIT/Ib+tIUOWiSn+0EvodJ5rtG1FQHz0=',
  'sha256-drop128':
    'PRYaxV/8RkMyIT/Ib+tIUA==',
  'sha384':
    'MND9nz6pxbQC5m41ZPRXhJIuqTj9/hu4gtWZ8t8LgdFLQFWQfC8jhijB0NHLpeA7',
  'sha384-drop192':
    'MND9nz6pxbQC5m41ZPRXhJIuqTj9/hu4',
  'sha512':
    'Hr4KLVLyglIwQ43C9U2bmieWBVLnD/F+lzCSF072Ds2b87MK+gbnR0p75A+I+5ez+aiemMGuMZyKVAUWfMMaUA==',
  'sha512-drop256':
    'Hr4KLVLyglIwQ43C9U2bmieWBVLnD/F+lzCSF072Ds0='
};

function testHmac(algo) {
  var block = {};
  block.topic = function() {
    var opts = {
      signatureAlgorithm: algo,
      signatureKey: sixtyFourByteKey
    };
    var iv = new Buffer('01234567890abcdef','binary'); // 128-bits
    var ciphertext = new Buffer('0123456789abcdef0123','binary');
    var duration = 876543210;
    var createdAt = 1234567890;

    return cookieSessions.util.computeHmac(
      opts, iv, ciphertext, duration, createdAt
    ).toString('base64');
  };

  block['equals test vector'] = function(val) {
    assert.equal(val, HMAC_EXPECT[algo]);
  };

  return block;
}

suite.addBatch({
  "computeHmac": {
    "sha256": testHmac('sha256'),
    "sha256-drop128": testHmac('sha256-drop128'),
    "sha384": testHmac('sha384'),
    "sha384-drop192": testHmac('sha384-drop192'),
    "sha512": testHmac('sha512'),
    "sha512-drop256": testHmac('sha512-drop256'),
  }
});

suite.export(module);
