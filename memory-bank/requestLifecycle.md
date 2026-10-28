---
title: Request Lifecycle
description: End-to-end spine document for Shiny Server — what lib/main.js builds at startup and in what order, the Express/Connect middleware stack and why its order matters, how a plain HTTP request, a SockJS transport request, and a WebSocket upgrade are each dispatched through the router chain to a scheduler-owned R/Python worker, which requests (ping, __assets__, __sockjs__, static files, directory index, redirects, error pages) never reach an app, and exactly what is rebuilt vs. preserved across a SIGHUP config reload or a SIGINT/SIGTERM shutdown.
---

# Request Lifecycle

This is the spine that ties together the config, router, scheduler, worker, and
proxy subsystems. Read this first; the other docs go deeper on each box.

The 30-second version: `lib/main.js` builds one long-lived object graph at
require time, then a *separate*, re-runnable step (`loadConfig_p`) plugs the
config-derived pieces into it. A request arrives on one of N `http.Server`
instances, is funnelled through a single Express app, and — if nothing earlier
in the stack claims it — ends up in `ShinyProxy.httpListener`, which asks the
router chain "which app is this?", asks the scheduler "give me a worker for that
app", and then reverse-proxies to a loopback TCP port that an R or Python
process is listening on.

## 1. Startup sequence (`lib/main.js` + `lib/server-init.js`)

Startup is split in two. **`lib/main.js`** is the CLI: a top-to-bottom script
with module-scope side effects (`optimist.argv`, `process.exit`, the pidfile,
signal handlers), so it still isn't something you can `require()`.
**`lib/server-init.js`** holds everything else, and *is* requirable —
`createServer_p(configFilePath, options)` builds the object graph, reads the
config, starts listening, and resolves to a handle. That extraction is what
makes in-process integration testing possible; see `testingGuide.md`.

In order:

1. **Version + CLI** (`lib/main.js`). `--version` exits here. Arguments are read
   straight off `optimist.argv` at module scope, not passed in.
   `SHINY_SERVER_VERSION` is no longer set here: it lives in
   **`lib/core/version.js`**, which publishes the global as a side effect of
   being required. `server-init.js` requires it on every startup path, so the
   global is populated whether or not the CLI ran. (It has to be a global
   because `lib/worker/app-worker.ts:571` reads it that way when launching a
   worker.)
2. **Pidfile** (`lib/main.js`), via a POSIX record lock (`fcntl`) in
   `lib/core/fsutil.js:141-155`. Failure to lock exits 1.
3. **Config path** resolution (`lib/main.js`), defaulting to
   `/etc/shiny-server/shiny-server.conf`. Note the config is *not* read yet.
4. **`createServer_p`** is called, and everything from here down happens inside
   `lib/server-init.js`:
5. **Object graph construction** — see below. All of this happens before any
   config is parsed, which is why the graph is built around mutable seams.
6. **Express app + middleware stack.**
7. **`Server` facade + event wiring.** No sockets are bound yet; `Server` has no
   addresses.
8. **`loadConfig_p()`** is invoked. This is the first point at which anything
   listens on a port. A failure here rejects, and `main.js` exits 1.
9. **Signal handlers** (`lib/main.js`), which drive the handle's `reload_p()`
   (SIGHUP), `dump()` (SIGUSR1), and `stopListening_p()` / `shutdownWorkers()`
   (SIGINT/SIGTERM/SIGABRT).

`createServer_p` does not resolve until every listener has emitted `'listening'`
or `'error'` — `setAddresses()` itself returns as soon as `listen()` is called.
Bind failures are *not* fatal and do not reject: they are logged and forwarded as
`'error'` events exactly as before, and also reported on the handle as
`bindErrors`. The handle's `addresses()` returns the bound `net.Server#address()`
objects, which is the only way to discover the port when the config said
`listen 0`.

### The object graph

```
SimpleEventBus ──┬──> SchedulerRegistry ──> SimpleScheduler (one per AppSpec key)
                 │                              └──> WorkerEntry ──> AppWorkerHandle ──> Endpoint (loopback TCP port)
                 └──> AppConfig (owned by LocalConfigRouter; per-app .shiny_app.conf cache)

metarouter = SquashRunAsRouter                        <- collapses runAs[] to one user
               └─ LocalConfigRouter                   <- merges per-app config overlay
                    └─ RestartRouter                  <- stamps settings.restart from restart.txt
                         └─ CompositeRouter
                              ├─ IndirectRouter  ──> ConfigRouter   (SWAPPED on reload)
                              └─ ping()                             (lib/server-init.js)

ShinyProxy(metarouter, schedulerRegistry)   -> app.use(shinyProxy.httpListener)
sockjsServer = proxy_sockjs.createServer(metarouter, schedulerRegistry, ...)  (REBUILT on reload)

Server (facade)  ──> N x http.Server, one per unique listen address
   'request'  -> app.handle (express)   AND   -> requestLogger (morgan)
   'upgrade'  -> sockjsHandler.upgrade
```

Two seams make reload possible without rebuilding the world:

- **`IndirectRouter`** (`lib/router/router.js:65-80`) sits at the *bottom* of
  the chain holding a swappable inner router. On reload only the `ConfigRouter`
  is replaced (`lib/server-init.js`); every decorator above it — and, crucially,
  `LocalConfigRouter`'s `AppConfig` cache — survives.
- **`SchedulerRegistry.setTransport`** (`lib/scheduler/scheduler-registry.js:48-54`)
  and `transport.setSocketDir` are re-applied each reload, but the registry and
  every running worker persist.

The router chain is **delegate down, decorate up**: each wrapper calls the inner
router first and then post-processes the resulting `AppSpec` on the way back
out. So the resolution order is `ConfigRouter` (or `ping`) → `RestartRouter`
annotates → `LocalConfigRouter` merges → `SquashRunAsRouter` collapses. The
comment at `lib/router/local-config-router.js:17-23` explains the one
non-obvious constraint: `LocalConfigRouter` must sit *outside* `RestartRouter`,
because its cache is keyed on an `AppSpec` whose settings already include the
`restart.txt` timestamp.

### `loadConfig_p` — the reloadable half

`lib/server-init.js`, wrapped in `qutil.serialized` (`lib/core/qutil.js:29-51`)
so overlapping SIGHUPs queue rather than interleave. It:

- parses the config against `config/shiny-server-rules.config` and builds a new
  `ConfigRouter` (`lib/router/config-router.js:32-40`), which also does the
  root/permissions sanity checks in `checkPermissions`;
- installs it into `indirectRouter`, propagates `allow_app_override`;
- calls `server.setAddresses(...)` — this is what actually binds ports;
- builds a **brand-new SockJS server** and replaces the `sockjsHandler`
  placeholder from `lib/server-init.js`;
- updates the closure variables `socketTimeout`, `useCompression`, and
  `requestLogger`, all of which are read *per connection / per request*, so the
  new values take effect immediately without touching the middleware stack.

## 2. The middleware stack

Installed in this exact order (`lib/server-init.js`):

| # | Middleware | Notes |
|---|---|---|
| 1 | `X-Powered-By: Shiny Server` | Express's own header is disabled at `:159` first. |
| 2 | conditional `compression()` | Guarded by the mutable `useCompression` flag, so `http_allow_compression` is honored per-request after a reload. |
| 3 | `sockjsHandler` | `if (!sockjsHandler(req,res)) next()`. |
| 4 | `__assets__` filter | `connect_util.filterByRegex(/\b__assets__\/.+/, ...)`. |
| 5 | `shinyProxy.httpListener` | Terminal — never calls `next()`. |

There is **no session middleware**. A `client-sessions` entry sat at position 3 until
2026-09; it was entirely vestigial and was removed. See
`memory-bank/proxyLayer.md` for the full autopsy — in particular, it never emitted a
cookie, so don't go looking for one.

Why the order matters:

- **SockJS before assets before proxy.** Both `__sockjs__` and `__assets__` are
  requested by the browser *relative to the app prefix* — `R/SockJSAdapter.R:217-224`
  injects `<script src='__assets__/sockjs.min.js'>` etc. into the app page, so
  the browser asks for `/myapp/__assets__/sockjs.min.js`. Those URLs are inside
  an app's prefix and would otherwise be proxied straight into R. Both
  middlewares must therefore run before the proxy, and the assets regex is
  deliberately unanchored (`\b__assets__\/`) with everything up to and including
  `__assets__/` stripped from `req.url` at `lib/server-init.js`.
- **The proxy is terminal.** `httpListener(req, res)` takes no `next`. Every
  path through it either responds (404/500/503) or hands off to `http-proxy`.
  There is no error-handling middleware anywhere in the app, so Express's
  `finalhandler` is effectively only reachable via a synchronous throw.

`sockjsHandler` returns a boolean because of `Listener.prototype.handler` in
`node_modules/sockjs/lib/sockjs.js:146-152`: it returns `false` immediately if
the URL doesn't match the prefix regex, and `true` after handling. The same
function object is also used for upgrades — `Server.prototype.middleware` sets
`handler.upgrade = handler` — which is why `sockjsHandler.upgrade(req, socket, head)`
works in `lib/server-init.js`.

## 3. Dispatch: plain HTTP request to an app

`lib/proxy/http.js:93-227`.

1. `req.pause()` immediately (`:97`) — routing is asynchronous and data must not
   be dropped. It is resumed at `:208`, *after* `proxy.web()` is called.
2. `router.getAppSpec_p(req, res)`. The contract (documented at
   `lib/router/router.js:44-58`) has three outcomes: an `AppSpec` (proxy it),
   `true` (already fully responded — redirect, static file, 403, directory
   index), or falsy (not mine → 404).
   - `ConfigRouter.getAppSpec_p` (`lib/router/config-router.js:143-173`) scores
     every `server` block against the request (port, local IP, `server_name`;
     scoring rules documented at `:272-291`), discards non-matches, sorts by
     score, and tries them in order.
   - `ServerRouter.getAppSpec_p` (`:334-344`) stamps `req.templateDir` onto the
     request *before* trying locations, so that a 404 or 500 produced without an
     `AppSpec` can still use the right custom template directory.
3. `?w=` selects a specific worker (`lib/proxy/http.js:117`). `SimpleScheduler`
   ignores it; it exists for the scheduler implementations in the Pro product.
4. **Prefix stripping** (`:123-131`). The router is *required* to return an
   `AppSpec` whose `prefix` is a prefix of `req.url`; a violation is logged as a
   server bug and turned into a 404.
5. **Session accounting** (`:135-176`). `isAppPagePath` (`lib/core/url-util.js`)
   is true for `/` and `*.Rmd`/`*.qmd`. For such requests the worker gets both an
   `http` and a `pending` acquisition — `pending` is a *reservation* for the
   SockJS connection that is about to follow, so that `maxRequests` capacity
   checks don't hand the last slot to someone else in between. On response
   finish/close, `http` is released; `pending` is released immediately if the
   response failed, or handed to a 45-second timer if it succeeded
   (`lib/scheduler/worker-entry.js:87-89, 164-188`).
6. `wrk.getAppWorkerHandle_p()` resolves once the worker's loopback port accepts
   connections (retry loop in `lib/scheduler/scheduler.js:56-109`).
7. An `http-proxy` instance is created **once per worker** and cached on the
   `appWorkerHandle` (`lib/proxy/http.js:184-193`), closed when the worker exits.
   The comment at `:229-233` explains why `RoutingProxy` isn't used.
8. `req.headers['shiny-shared-secret']` is set (`:204`) from the endpoint's
   per-worker random secret (`lib/transport/shared.js:22`). The worker enforces
   it via `options(shiny.sharedSecret=...)` from the `SHINY_SHARED_SECRET` env
   var (`R/SockJSAdapter.R:26,105`). This is the only thing stopping any local
   process from talking to a worker's port.
9. `proxy.web(req, res)`, then `req.resume()`.

On the way back, the `proxyRes` handler (`:252-259`) records
`res.proxySuccess` (used by the pending-release logic above) and applies
`frameOptions`.

## 4. Dispatch: SockJS and WebSocket upgrade

Browsers never open a WebSocket directly to a worker. There are two hops:
browser ⇄ Shiny Server (SockJS, possibly multiplexed, possibly "robust") and
Shiny Server ⇄ worker (a plain WebSocket via `faye-websocket`).

**HTTP-based SockJS transports** (xhr-polling, xhr-streaming, jsonp, eventsource,
htmlfile, plus `/info` and the iframe/welcome pages) arrive as ordinary requests
and are claimed by middleware #3. The SockJS prefix is
`'.*/__sockjs__(/[no]=\\w+)?'` (`lib/proxy/sockjs.js:42`) — the leading `.*`
is what lets a single SockJS server serve every app prefix, and the optional
`/n=` / `/o=` path param is the robust-reconnect session id consumed by
`lib/proxy/robust-sockjs.js`.

**WebSocket upgrades** bypass Express entirely — Express only handles
`'request'`. `lib/server-init.js` handles `'upgrade'` on the `Server` facade by
calling `sockjsHandler.upgrade` directly.

Once SockJS produces a connection (`lib/proxy/sockjs.js:49-62`) it goes through
two wrappers before routing:

1. `RobustSockJS.robustify` — if the URL carries an `n=`/`o=` param, the
   connection is attached to (or resumes) a durable session that survives brief
   network drops. Not robust → passed through unchanged.
2. `MultiplexSocket` — one physical connection can carry many logical channels;
   each channel gets its own `url` (resolved relative to the parent connection,
   `lib/proxy/multiplex.js:75-92`) and is emitted as its own `'connection'`.

Each *channel* is then routed independently through the same `metarouter`
(`lib/proxy/sockjs.js:76`). This is the key coupling to be aware of: **every
router in the chain must work on both an `http.IncomingMessage` and a SockJS
connection object.** That is why routers check `req.address || req.connection.address()`
(`lib/router/config-router.js:295-303`), and why `SingleAppRouter` and
`RedirectRouter` explicitly bail out when `res` is absent
(`lib/router/router.js:223-233`, `:320-322`). SockJS itself only copies a
whitelist of headers onto the connection — `host` is among them
(`node_modules/sockjs/lib/transport.js:147-175`), which is what makes
`server_name` vhost matching work for websockets.

After routing (`lib/proxy/sockjs.js:100-251`):

- `pause(conn)` around the async routing step, mirroring `req.pause()` on the
  HTTP side; data arriving before the worker socket exists is queued in
  `connEventQueue` and replayed on `wsClient.onopen`.
- `reconnect: false` apps refuse robust connections outright (`:85-89`).
- `wrk.shiftPendingReleaseTimer(); wrk.release("pending")` (`:145-146`) cashes in
  the reservation made by the app-page HTTP request. `acquire("sock")` /
  `release("sock")` on close must balance exactly or the worker leaks.
- The worker-side URL is derived by replacing `/__sockjs__/...` with
  `/websocket/` (`:166`) and connecting to `ws://127.0.0.1:<port>` with the
  shared-secret header (`lib/transport/tcp.js:123-146`).
- If the worker's socket closes unexpectedly, the tail of its stderr log is
  pushed to the browser console and an alert is raised, unless
  `sanitizeErrors` is on (`:191-237`).

## 5. Requests that never reach an app

- **`/ping`** → `200 OK` (`lib/server-init.js`). It is joined *after*
  `indirectRouter` in the composite (`lib/server-init.js`), so a config location
  mapped to `/ping` wins over the health check.
- **`*/__assets__/*`** → `shiny-server.css` from `assets/`,
  `shiny-server-client[.min].js` from `node_modules/shiny-server-client/dist/`,
  `sockjs[.min].js[.map]` from `node_modules/sockjs-client/dist/`. One-day
  `maxAge`. Misses render a 404 page, never fall through to the proxy.
- **`*/__sockjs__/*`** → SockJS transports (above).
- **Static files under a `site_dir`** — `DirectoryRouter` serves anything that
  isn't inside an app directory via `send` (`lib/router/directory-router.js:145-206`)
  and returns `true`.
- **Directory index** — when `directory_index` is on and there's no
  `index.html`, `$autoindex_p` renders `templates/directoryIndex.html`
  (`:208-265`).
- **403** for any path containing a hidden segment (`/\/\./`) or matching the
  blacklist (`:69-77`).
- **301 redirects** for missing trailing slashes, from both `SingleAppRouter`
  (`lib/router/router.js:223-233`) and `DirectoryRouter` (`:92-99`, `:157-167`),
  and from `redirect` config directives via `RedirectRouter`.
- **`index.html` served in lieu of `index.Rmd`** — a deliberate exception in
  both `SingleAppRouter` (`lib/router/router.js:277-297`) and `DirectoryRouter`
  (`:104-124`), because rmarkdown would 404 on the bare directory URL.
- **Error pages** — 404/500/503 are rendered by `lib/core/render.js` through a
  cascading template lookup: `error-503-users.html` → `error-503.html` →
  `error.html`, checking the app/server `templateDir` before `templates/`.
  Results are memoized in a module-level cache that SIGHUP flushes
  (`lib/main.js`).

## 6. Reload, restart, and shutdown

**SIGHUP** (`lib/main.js`) flushes the template cache and re-runs
`loadConfig_p`.

Rebuilt: `ConfigRouter` and all `ServerRouter`/location routers; the SockJS
server, its `RobustSockJS` registry, and `sockjsHandler`; the morgan access
logger; `socketTimeout`; `useCompression`; the set of bound listeners.

Preserved: the event bus; the entire router decorator chain and
`LocalConfigRouter`'s `AppConfig` cache; the `SchedulerRegistry` **and every
running worker process**; the transport; the Express app and its middleware
instances; and any `http.Server` whose
address/port is unchanged (`Server.setAddresses` diffs by
`http://<host>:<port>` key and only opens/closes the delta,
`lib/server/server.js`). Existing connections on a *removed* listener are
not killed — `$close` only stops accepting. (`test/support/server.js` therefore
destroys them by hand at teardown; production deliberately does not.)

`$close` used to have a second, worse problem: `doClose` early-returned for a
server that had not finished binding, while the caller dropped it from
`$wildcards`/`$hosts` regardless — so a mid-bind listener was leaked, still
holding its port with nobody left to close it. It now waits for the bind to
settle (`'listening'` or `'error'`) before closing, and `$close`/`destroy()`
return a promise that resolves once every listener has actually emitted
`'close'`. `test/integration/harness.js` has the regression test.

Two consequences worth internalizing:

- **A reload does not restart apps.** `AppSpec.getKey()` includes
  `JSON.stringify(settings)` (`lib/worker/app-spec.ts:29-35`), so if the reload
  changes an app's effective settings the next request produces a *different*
  key, a *new* scheduler, and a *new* worker — while the old scheduler keeps
  serving its existing sessions until it goes vacant and emits `vacantSched`
  (`lib/scheduler/scheduler.js:188`), which prunes it from the registry
  (`lib/scheduler/scheduler-registry.js:38-41`) and drops the matching
  `AppConfig` cache entry (`lib/config/app-config.js:28-30`). Same mechanism
  backs `touch restart.txt` (`RestartRouter`).
- **In-flight SockJS sessions are orphaned by the new SockJS server.** Already-
  upgraded WebSockets keep working (they're piped sockets held by the old
  server object), but polling transports and robust-reconnect ids are unknown to
  the replacement server, so clients will be forced to reconnect. *Inferred from
  the code shape; not verified empirically.*

**Shutdown.** `gracefulShutdown` (`lib/main.js`) sets
`shutdown.shuttingDown = true` — read by `lib/proxy/sockjs.js:215,225` so that
clients get "The server is restarting" and a `SHUTTING_DOWN` close code instead
of "the application unexpectedly exited" — closes listeners, tells the registry
to shut down workers, then hard-exits after 500 ms. `lastDitchShutdown` runs on
`'exit'` for the violent cases where timers will never fire. Exit codes follow
the `128+signal` convention.

**SIGUSR1** dumps the worker registry to the log (`lib/main.js`).

## 7. Sharp edges

- **`server.on('request', app.handle)`** (`lib/server-init.js`) uses a *private*
  Express API, and there is a **second** `'request'` listener for morgan after
  it. `test/integration/access-log.js` pins the ordering consequence. The access logger is therefore not middleware: it sees every request
  unconditionally and is swapped atomically on reload via a closure variable.
- **`lib/proxy/http.js:117` reads `req._parsedUrl`**, which only exists as a
  side effect of `parseurl` caching inside Express's router. Anything that
  bypasses `app.handle` will not have it.
- **The pre-config `'upgrade'` guard references an out-of-scope `res`**
  (`lib/server-init.js`, marked `KNOWN DEFECT` in place) — a `ReferenceError` if
  an upgrade arrives before the config finishes loading. Characterized but
  deliberately not fixed yet.
- **FIXED (2026-09): the `client-sessions`-on-upgrade swallow.** The middleware
  was removed outright rather than repaired, because it was vestigial; the
  upgrade handler now calls `sockjsHandler.upgrade()` directly and synchronously.
  See `memory-bank/proxyLayer.md`. The pre-config `res` defect above is
  unrelated and still open.
- **`server.listening` is read-only.** `lib/server/server.js` used to assign
  `server.listening = true/false`; that was a silent no-op, because
  `net.Server.prototype.listening` is a getter with no setter, so in sloppy mode
  the assignment is discarded. The assignments have been removed and a comment
  put in their place. The *reads* were always correct — they see Node's own
  `!!this._handle` — so do not "fix" them on the assumption that a flag is being
  maintained.
- **`Server`'s `newListener` trick** (`lib/server/server.js:55-73`) records
  every event name ever subscribed and retro-fits forwarding onto both existing
  and future `http.Server`s. It works in both orders, but it means listener
  registration order on the facade determines invocation order across *all*
  bound addresses.
- **Socket timeout is a foot-gun.** The 45s default and the comment at
  `lib/server-init.js` document that Node's `setTimeout` clock starts at the
  last `write()` call, not at the last completed write, so active connections
  can still trip it. `sockjs_heartbeat_delay` must stay comfortably below it.
- **`req.url` mutation.** The `__assets__` middleware rewrites `req.url` to a
  *leading-slash-less* path before handing it to `express.static`
  (`lib/server-init.js`), and the proxy rewrites `req.url` again to strip the
  app prefix (`lib/proxy/http.js:129`). Anything downstream that wants the
  original must use `req.originalUrl`.
- **No error-handling middleware, and `NODE_ENV` is never set**, so Express
  defaults to `development` and an unhandled synchronous throw returns a stack
  trace to the browser.
- **`_p` / Q conventions.** `_p` means "returns a Q promise". `.eat()`
  (`lib/core/qutil.js:20-22`) swallows rejections; `.done()` re-throws them as
  uncaught exceptions. Both `lib/proxy/http.js:141-153` and
  `lib/proxy/sockjs.js:125-137` deliberately call `schedulerRegistry.getWorker`
  *outside* the promise chain with a `try/catch`, because a synchronous
  `OutOfCapacityError` thrown inside the chain would escape as an unhandled
  exception rather than reaching `.fail()`.
- **Ephemeral ports can be handed out twice, across address families.**
  `TcpTransport.alloc_p` picks a worker port by binding `127.0.0.1:0`, reading
  the port, and closing again. Anything that binds the wildcard `::` in that
  window can be given the same port — and a later specific-address bind on
  `127.0.0.1` then *succeeds*, shadowing the wildcard listener for loopback
  traffic. Production rarely hits this (the listen port is configured, not
  ephemeral), but it made the integration suite flaky until the harness pinned
  its listener to `127.0.0.1`. See `testingGuide.md`.
- **`qutil.serialized` hands a queued caller the *previous* call's outcome**,
  because Q's `.fin()` settles with the original promise's value even when its
  callback returns a promise. Harmless today — the only production user is
  `loadConfig_p`, whose queued caller is the SIGHUP handler, which `.eat()`s the
  result — but a live trap for the Q removal. Pinned in `test/qutil.js`.
- **Dead imports have been removed** from what is now `lib/server-init.js`
  (`UnixSocketTransport`, `SimpleScheduler`), along with `qutil.withTimeout_p`,
  `qutil.fapply`, the unused `posix` require in `lib/router/router.js`, and the
  never-called `isKeepalive`/`stripConnectionHeaders` in `lib/proxy/http.js`.
