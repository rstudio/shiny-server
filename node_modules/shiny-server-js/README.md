# Shiny Server unified client

This npm library provides unified client code for Shiny Server, Shiny Server Pro, and RStudio Connect. Previously, each server product had its own version of this code with slight differences. This repo provides the superset of functionality needed by the different products, and runtime options determine what features to enable.

### How to use

In the server directory, install the module using `npm`. If the server already uses node modules, you can easily install `shiny-server-js` to your existing package.json like this:

```
npm install --save shiny-server-js
```

Otherwise, you'll need to create a package.json file first, using the `npm init` command, then run the above command.

In your server code, use `node_modules/shiny-server-js/dist/shiny-server.js` and `shiny-server.min.js` to get to the client JS.

### How to build

If you want to make changes, you'll need to build. Node.js v0.10 or above should work. We build using browserify with a babel plugin for ES2015 support, and minify using uglifyjs.

One-time setup:

```
npm install
```

Build targets:

```
make        # Build client and minify
make build  # Build client but don't minify
make test   # Run mocha tests (DOESN'T build)
make clean
```

Be sure to run `make` before commiting changes to `lib` or `common`! If your code changes are not reflected in the build artifacts, they won't be picked up by the servers.

### Project layout

- `/lib` - Client code. ES2015 is allowed; we transpile using babel.
- `/common` - Shared code between client and Node.js-based servers. ES2015 not allowed, due to servers still using Node v0.10. (If this becomes a pain point we could transpile here too.)
- `/test` - Unit tests (mocha, chai, sinon). ES2015 is allowed.
- `/dist` - Final build artifacts go here.
