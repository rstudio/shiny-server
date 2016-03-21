# Shiny Server unified client

[![Build Status](https://travis-ci.org/rstudio/shiny-server-client.svg?branch=master)](https://travis-ci.org/rstudio/shiny-server-client)

This npm library provides unified client code for Shiny Server, Shiny Server Pro, and RStudio Connect. Previously, each server product had its own version of this code with slight differences. This repo provides the superset of functionality needed by the different products, and runtime options determine what features to enable.

### How to use

In the server directory, install the module using `npm`. If the server already uses node modules, you can easily install `shiny-server-client` to your existing package.json like this:

```
npm install --save https://github.com/rstudio/shiny-server-client/archive/master.tar.gz
```

Otherwise, you'll need to create a package.json file first, using the `npm init` command, then run the above command.

In your server code, use `node_modules/shiny-server-client/dist/shiny-server-client.js` and `shiny-server-client.min.js` to get to the client JS.

### How to build

If you want to make changes, you'll need to build. Node.js v0.10 or above should work. We build using browserify with a babel plugin for ES2015 support, and minify using uglifyjs.

One-time setup:

```
npm install
```

Build targets:

```
make        # Build client, minify, and lint
make build  # Build client and minify, but don't lint
make test   # Run mocha tests (DOESN'T build)
make lint   # Lint
make clean  # Delete build artifacts
```

Be sure to run `make` before commiting changes to `lib` or `common`! If your code changes are not reflected in the build artifacts, they won't be picked up by the servers.

You can run Mocha in "watch" mode if you have an ES6-compatible version of Node (i.e. not v0.10.x, which is what Shiny Server and Shiny Server Pro use at the time of this writing):

```
node_modules/.bin/mocha -w --reporter dot
```

Running mocha directly is much faster than `make test` because the latter runs the test code through babel, in order to support ES6 on Node v0.10.x.

### Project layout

- `/lib` - Client code. ES2015 is allowed; we transpile using babel.
- `/common` - Shared code between client and Node.js-based servers. ES2015 not allowed, due to servers still using Node v0.10. (If this becomes a pain point we could transpile here too.)
- `/test` - Unit tests (mocha, chai, sinon). ES2015 is allowed.
- `/dist` - Final build artifacts go here.

### License

This library is licensed under the terms of the [AGPLv3](http://www.gnu.org/licenses/agpl-3.0.en.html) unless distributed with one of our proprietary server products, in which case that product's license applies.
