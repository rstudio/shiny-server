// a NODE_ENV of test will supress console output to stderr which
// connect likes to do when next() is called with a non-falsey error
// message.  We test such codepaths here.
process.env['NODE_ENV'] = 'test';

var vows = require("vows"),
    assert = require("assert"),
    cookieSessions = require("../lib/client-sessions"),
    express = require("express"),
    tobi = require("tobi"),
    Browser = require("zombie");

function create_app() {
  // set up the session middleware
  var middleware = cookieSessions({
    cookieName: 'session',
    secret: 'yo',
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
    cookie: {
      maxAge: 5000
    }
  });

  app.use(secureStoreMiddleware);

  return app;
}

var suite = vows.describe('all');

suite.addBatch({
  "a single request object" : {
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
        delete req.session['bar'];
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
  "querying twice, each at 3/4 duration time": {
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
      browser.get("/foo", function(res, $) {});
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

suite.export(module);
