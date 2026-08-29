---
title: Core Utilities
description: Inventory and rationale for the shared helper modules under lib/core/ and lib/events/ — Q promise idioms in qutil.js (serialized, forEachPromise_p, map_p, wrap, the .eat() monkeypatch), null-prototype maps, fsutil, paths, permissions, iputil (ip-address v9), url-util, re-quote, shutdown, connect-util, python venv resolution, SimpleEventBus, and lib/globals.d.ts. Read this before writing a new helper, when tracing a Q promise chain, or when touching the graceful-shutdown or vacantSched event protocols.
---

# Core Utilities

`lib/core/` is the bottom of the dependency graph: no module here imports from
`lib/router/`, `lib/proxy/`, `lib/scheduler/`, or `lib/config/`. Most are under
40 lines. This doc is the "reach for this instead of writing a new one" index.

Out of scope here: `lib/core/log.js`, `lib/core/render.js`, and
`lib/core/errors.js` — see `memory-bank/loggingAndErrors.md`.

## `lib/core/qutil.js` — the Q promise layer

This codebase predates native promises and still runs on Q (`q@^1.5.1`).
Roughly 98 `_p`-suffixed functions exist across `lib/`; the suffix is the
convention meaning "returns a promise" (`getAppSpec_p`, `launchWorker_p`,
`readConfig_p`, `resolvePython_p`, …). Async-ness is not otherwise visible in
the type system for the `.js` files, so the suffix is load-bearing.

### The `.eat()` monkeypatch (the single most important thing here)

`lib/core/qutil.js:20-22` installs `eat()` onto `Q.makePromise.prototype`:

```js
Q.makePromise.prototype.eat = function() {
  this.fail(function(err) {});
};
```

`.eat()` terminates a promise chain and swallows any rejection. It is the
counterpart to Q's `.done()` (which terminates and *rethrows* unhandled
rejections as a global exception). Use `.eat()` when you have already
`.fail`-logged the error and just want to suppress Q's unhandled-rejection
noise; use `.done()` when an error genuinely should crash.

**Trap:** `eat()` returns `undefined`, so you cannot chain after it, and the
patch is installed as a *side effect of requiring qutil*. Several modules call
`.eat()` without requiring qutil at all — `lib/proxy/http.js:192`,
`lib/scheduler/scheduler.js` (102, 162, 225, 270), `lib/worker/app-worker.ts:553`.
They work only because `lib/server-init.js` requires qutil early, and
`lib/main.js` requires `lib/server-init.js` before it calls `.eat()` itself. Tests are made to
work the same way by `.mocharc.json`, which force-requires
`./lib/core/log` and `./lib/core/qutil` before any test file. If you write a new
entry point or a standalone script that uses `.eat()`, require qutil explicitly.

`lib/globals.d.ts:8-13` declares `eat()` and `done()` onto `Q.Promise` via
declaration merging so the `.ts` files can call them.

### Exported helpers

- **`serialized(func)`** (`qutil.js:29`) — wraps a promise-returning function so
  that concurrent invocations queue rather than overlap. If a call is in flight,
  the new call chains off `currentPromise.fin(...)` and re-enters `wrapped`;
  `currentPromise` is nulled in a `.fin` registered immediately after the call,
  so the ordering guarantee holds even for a burst of queued callers.
  **But the value does not.** Q's `.fin()` settles with the *original* promise's
  outcome even when its callback returns a promise, so a queued caller receives
  the outcome of whatever ran ahead of it, not its own. Benign only because the
  sole production caller discards the result. Pinned in `test/qutil.js`; see
  `requestLifecycle.md` §7.
  Sole consumer: `lib/server-init.js`, wrapping `loadConfig_p`. That is what makes
  a burst of `SIGHUP`s safe — config reloads never interleave.
- **`forEachPromise_p(array, iterator, accept, defaultValue)`** (`qutil.js:91`) —
  sequential first-match search. Calls `iterator(el)` (promise-returning) one
  element at a time; the first result for which `accept(result)` is truthy wins;
  falls through to `defaultValue` at the end; any rejection aborts the whole
  thing. This is *the* router-chain primitive:
  `lib/router/router.js:119` (`getFirstAppSpec_p` — walk routers until one
  claims the request) and `lib/router/directory-router.js:355` (walk candidate
  subpaths until one is a real app dir).
- **`wrap(func)`** — calls a synchronous function and returns a promise of its
  result, converting a throw into a rejection. Used to adapt a synchronous router to the
  promise-returning `getAppSpec_p` interface: `lib/router/router.js:320`
  (`RedirectRouter`).
- **`map_p(collection, func_p)`** (`qutil.js:158`) — **sequential** map, not
  parallel. Chains each call off the previous one. Sole consumer:
  `lib/router/directory-router.js:227` (stat every file in a directory listing).
  Two gotchas: it indexes with `collection[index]`, so it is array-only despite
  taking a "collection"; and it resolves to the accumulating `results` array
  (the last `.then` returns `results`), which happens to be correct but is easy
  to break when editing.

### Q idioms you will meet elsewhere in the codebase

- **Deferreds.** `var d = Q.defer(); … return d.promise;` — 13 sites. Used
  wherever a node-style callback or an event has to be bridged into a promise.
- **`Q.nfcall(fn, args…)`** — 13 sites. Promisifies a single node-style
  callback call, e.g. `Q.nfcall(fs.open, path, 'r')` in `fsutil.js:77`.
- **`.fail(fn)`** (Q's `.catch`) and **`.fin(fn)`** (Q's `.finally`) — 17 and 10
  sites. `.fin` is heavily used for cleanup that must run on both paths (closing
  fds, freeing endpoints, deleting worker entries).
- **`.invoke('method')`** — Q sugar that calls a method on the resolved value and
  returns a promise. `lib/scheduler/scheduler.js:179`:
  `workerPromise.invoke('getExit_p')`.
- **Bridging native promises into Q.** The `.ts` files use real `async`/`await`.
  `Q.resolve(nativePromise)` converts back (`lib/worker/app-worker.ts:134`), and
  `launchWorker_p` is typed as returning `Q.Promise<AppWorker>` so the
  JavaScript scheduler can keep using `.invoke`/`.fin` on it. Do not assume a
  promise crossing a `.js`/`.ts` boundary is a Q promise — check.

## `lib/core/map.js`

Two exports, and the "why" is not prototype pollution defense in the modern
attacker sense:

- **`create()`** (`map.js:20`) — `Object.create(null)`. The comment cites
  devthought.com's "An object is not a hash" — the point is that `{}` inherits `toString`,
  `constructor`, `hasOwnProperty`, `__proto__`, etc., so `if (cache[key])` and
  `key in cache` produce false positives for keys like `"constructor"`, and
  assigning `__proto__` silently doesn't work. Since the keys here are
  user-controlled (app keys derived from URL paths and usernames, config
  directive names, env var names), a null-prototype object is the correct
  container. It is *also* a prototype-pollution mitigation, but the stated
  motivation is correctness.
  Consumers are everywhere a keyed cache or registry exists:
  `lib/scheduler/scheduler-registry.js:35` (`$schedulers`),
  `lib/scheduler/scheduler.js:41` (`$workers`), `lib/config/app-config.js:25`
  (`$cache`), `lib/config/schema.js:21,112`, `lib/core/render.js:20,145`
  (template cache), `lib/server/server.js:48-49`,
  `lib/router/config-router.js:191,495`, `lib/router/config-router-util.js:51`,
  `lib/worker/run-as.js:38` (child env).
- **`compact(x)`** (`map.js:28`) — underscore-based copy with `null`/`undefined`
  own properties removed. Used only to build child-process environments:
  `lib/worker/app-worker.ts:598` and `:623`. This is how "don't set `LANG` if the
  server doesn't have one" is expressed.

**Trap:** `compact` returns a normal `{}` (underscore's `_.omit`), not a
null-prototype object. `create()` and `compact()` are not composable in the way
the shared module name suggests.

## `lib/core/paths.js`

- `projectRoot` (`paths.js:15`) — `lib/core/../../`, i.e. the install root.
  Exported but **has no consumers outside this file** — vestigial.
- `projectFile(filename)` (`paths.js:19`) — the one that matters. Resolves files
  shipped with the server: `assets/`, `templates/`, `config/shiny-server-rules.config`,
  `R/SockJSAdapter.R`, `python/SockJSAdapter.py`, `scripts/create-log.sh`,
  `ext/pandoc`, and the bundled `node_modules/shiny-server-client/dist/`.
  Consumers: `lib/main.js`, `lib/core/render.js:60`, `lib/config/app-config.js:47`,
  `lib/router/config-router.js:35`, `lib/worker/app-worker.ts:38,39,177,574`.

Use `projectFile` for anything installed alongside the server; never build such
paths from `process.cwd()`.

## `lib/core/fsutil.js` (+ `fsutil.d.ts`)

Uses `graceful-fs` (retries on EMFILE) rather than `fs`, and pulls in the native
`build/Release/posix` addon for record locking.

- `directoryExistsSync(path)` (`:22`) — true/false; rethrows non-`ENOENT`.
  Consumer: `lib/transport/unix-socket.js:39`.
- `exists_p(path)` (`:37`) — `fs.access`-based; resolves false on `ENOENT`,
  rejects on anything else (so a permission error is not silently "missing").
  Consumer: `lib/core/python.ts:25`.
- `safeTail_p(path, maxlen, encoding='utf8')` (`:69`) — reads at most `maxlen`
  bytes from the end of a file and **never rejects**: any failure resolves to
  `""`. It skips leading UTF-8 continuation bytes and, when truncated, drops
  everything through the first `\n` so the result starts on a line boundary.
  This is the "show the R console log to the user" primitive — both call sites
  pass 8192: `lib/proxy/http.js:31` and `lib/proxy/sockjs.js:199`.
- `safeStat_p(path)` (`:127`) — resolves `null` instead of rejecting.
  Consumers: `lib/config/app-config.js:94`, `lib/router/router.js:97`
  (the `restart.txt` check).
- `createPidFile(path)` (`:142`) — synchronous; acquires a POSIX write record
  lock via the native addon and returns `false` if another process holds it.
  This, not the file's existence, is the single-instance check.
  Consumer: `lib/main.js`.

**Traps.**
1. `safeTail_p` calls `logger.error` (`:106`, `:117`) using the *global* `logger`
   installed by `lib/core/log.js` — another implicit load-order dependency.
2. `fsutil.d.ts` declares **only** `exists_p`. If you call any other fsutil
   function from a `.ts` file, `tsc` will fail until you add the declaration.
   (Verified: renaming `exists_p` in `python.ts` produces a TS2339 on
   `typeof import(".../fsutil")`.)

## `lib/core/permissions.js`

Thin wrapper over `process.getuid()` and the native `posix.getpwuid`.

- `isSuperuser()` (`:19`), `getProcessUser()` (`:25`, memoized by uid),
  `canRunAs(user)` (`:37` — root, or the requested user is us).

Consumers: `lib/router/config-router.js:46,67,81,99` (validate `run_as` and
privileged-port directives at config-parse time so misconfigurations fail loudly)
and `lib/worker/app-worker.ts:326,334` (decide whether to wrap the worker
spawn in a user switch).

## `lib/core/iputil.js`

Wraps the `ip-address` package (currently **v10**, `package.json:26`). Exists
because IPv6 comparison is not string comparison.

- `isValid(addr)` (`:32`), `isWildcard(addr)` (`:18`), `hasZone(addr)` (`:57`),
  `normalize(addr)` (`:62`), `equal(a, b)` (`:74`),
  `addrToHostname` / `hostnameToAddr` (`:95`, `:109` — add/strip the `[...]`
  brackets required for IPv6 literals in URLs).

Non-obvious behaviors:
- `equal` promotes IPv4 to IPv6 via `Address6.fromAddress4`, so
  `equal("::ffff:10.11.12.13", "10.11.12.13")` is **true**
  (`test/iputil.js:68`). Zone IDs are compared, so `…%ens33` ≠ the same address
  without a zone.
- `normalize` returns `correctForm() + zone` for IPv6, preserving the zone.
- `isWildcard` accepts the literal strings `"*"` and `"0.0.0.0"` specially, then
  canonical-compares against `::`. But `normalize("*")` **throws** — `"*"` is not
  a valid address. This is safe today only because
  `lib/router/config-router.js:205-207` rewrites `listen *` to `::` at
  config-parse time, before `lib/server/server.js:28` (`addressToKey`) ever calls
  `normalize`. Preserve that invariant.
- Zone IDs are accepted by `isValid` but explicitly rejected for `listen`
  directives at `lib/router/config-router.js:214-217`.

**The ip-address 6 → 7 migration** (commit `fba8b83`, "Upgrade ip-address
package ... semver-major") is why the file has private `isValidIPv4`/`isValidIPv6`
try/catch wrappers (`:38`, `:47`): from v7 on, the `Address4`/`Address6`
constructors *throw* `AddressError` on invalid input, whereas the older API let
you construct then call `.isValid()`. The package is now on `^10`, which keeps
the throwing constructors. If you touch this file, keep every `new Address*`
behind a validity check or a try/catch.

**Bug worth fixing:** `iputil.js:70` reads
``throw new Error(`Invalid IP address: "addr"`)`` — the `${}` is missing, so the
message always says the literal string `addr`.

Consumers: `lib/server/server.js:28,84,161` and `lib/router/config-router.js:209,214,310,312`.
`test/iputil.js` is the spec and is worth reading before changing anything here.

## `lib/core/url-util.js`

One function, `isAppPagePath(path)` (`:14`): true for `/` or a path ending in
`.Rmd`/`.qmd` (case-insensitive). Sole consumer: `lib/proxy/http.js:136`, to
decide whether a request that found no worker should render a friendly app-error
page vs. a plain 404.

## `lib/core/re-quote.js`

`module.exports = function(str)` (`:16`): escapes regex metacharacters so a
literal string can be interpolated into a `new RegExp(...)`. Consumers are the
routers that build prefix-matching regexes from configured URL paths:
`lib/router/router.js:26`, `lib/router/user-dirs-router.js:18`,
`lib/router/directory-router.js:19`. Modern code could use
`RegExp.escape`/a library, but this predates them; don't hand-roll a second copy.

## `lib/core/shutdown.js`

A one-line module (`:13`) exporting a single mutable boolean, `shuttingDown`.
It exists purely as a shared mutable cell — requiring it from two modules gives
them the same object.

The protocol, driven from `lib/main.js` through the handle that
`lib/server-init.js` returns:
1. `SIGINT` / `SIGTERM` / `SIGABRT` / the synthetic `uncaughtException2` event
   route to `gracefulShutdown()`: set `shutdown.shuttingDown = true`, call the
   handle's `stopListening_p()` (which is `Server#destroy()`) and
   `shutdownWorkers()` (which calls `shutdown()` on every scheduler), then
   `process.exit(exitCode)` after a **500 ms** grace window so clients can
   receive their close messages. Exit code is `128 + signo`. The handle also
   offers `shutdown_p()`, which does both and resolves once the listeners have
   closed; that is what the test harness uses.
2. `process.on('exit')` runs `lastDitchShutdown` (`main.js:362-374`) — same flag,
   same registry shutdown, but no timers (they won't fire during `exit`), so no
   client notification.
3. `needsCleanup` guards against the signal being delivered twice.

The flag's only *reader* is `lib/proxy/sockjs.js:215,225`: it changes the message
shown to the browser from "The application unexpectedly exited" to
"The server is restarting… refresh the page", and the SockJS close code from
`APP_EXIT` to `SHUTTING_DOWN` (so shiny-server-client won't treat the session as
permanently dead).

**Note:** `lib/proxy/http.js:23` requires `shutdown` but never reads it —
a leftover import.

## `lib/core/connect-util.js`

`filterByRegex(pathRegex, app)` (`:16`) returns Connect/Express middleware that
delegates to `app` only when `url.parse(req.url).path` matches, and otherwise
calls `next()`. Sole consumer: `lib/server-init.js`, gating the `__assets__/`
static-file handlers. Uses the legacy `url.parse` (deprecated but not removed);
`lib/server/server.js:155` uses `new url.URL` — the codebase is inconsistent.

## `lib/core/python.ts` / `python.js`

`resolvePython_p(pythonPath, baseDir?)` (`python.ts:15`) turns the configured
`python` app-default into the pieces needed to spawn a Python Shiny worker.
Returns `{ exec?, command?, path_prepend?, env? }`. Four cases:

| Input | Result |
|---|---|
| absolute path to a directory (`python.ts:18-35`) | treated as a virtualenv: `exec = <dir>/bin/python`, `path_prepend = <dir>/bin`, `env` sets `virtual_env` and clears `pythonhome`. Throws if `bin/python` is missing. |
| absolute path to a file (`:36-45`) | `exec = path`, after an `X_OK` access check (throws a clear "Can't execute" error otherwise). |
| bare name, no separator (`:50-55`) | `command = name`, resolved from `PATH` **later**, deliberately: the `PATH` search must happen after dropping to the `run_as` user, whose `PATH` may differ. |
| relative path + absolute `baseDir` (`:56-57`) | resolved against the app dir and re-entered. |

Sole consumer: `lib/worker/app-worker.ts:621` (`createPyShinySpawnSpec`), which
merges `pythonResult.env` through `map.compact`, prepends `path_prepend` to
`PATH`, and forces `PYTHONUNBUFFERED=1`.

**Suspected bug (flagging, not fixing):** the venv branch returns the env keys as
lowercase `virtual_env` / `pythonhome`, and they are passed verbatim into
`child_process.spawn`'s `env` alongside uppercase `HOME`/`LANG`/`PATH`. POSIX env
var names are case-sensitive, so the child sees `virtual_env`, not `VIRTUAL_ENV`.
The `pythonhome: null` is separately a no-op, because `map.compact` strips null
values and the env object is built from scratch anyway (nothing to clear).
Neither appears to break venv support in practice — `exec` and `path_prepend` do
the real work — but verify before relying on `VIRTUAL_ENV` being set.

`python.js` is the committed `tsc` output; edit the `.ts` and run `npm run build`.

## `lib/events/simple-event-bus.js`

`SimpleEventBus` (`:17-21`) is an `events.EventEmitter` subclass with an
**empty prototype body**. It adds nothing; it exists as a named type so that the
"there is one global bus" intent is legible at the injection sites.

Exactly one event flows over it: **`vacantSched`**, carrying an `appSpec.getKey()`.

- **Publisher:** `lib/scheduler/scheduler.js:188` — inside the `.fin` on a
  worker's exit promise, when the last worker for an app has gone away.
- **Subscribers:**
  - `lib/scheduler/scheduler-registry.js:38` — deletes the scheduler from
    `$schedulers`, so a future request creates a fresh one.
  - `lib/config/app-config.js:28` — evicts that app's cached
    `shiny-server-rules.config` overlay, so per-app config is re-read next time.

The bus is constructed once in `lib/server-init.js` and passed into
`SchedulerRegistry` (`main.js:133`) and `LocalConfigRouter` → `AppConfig`.
Tests construct their own (`test/scheduler.js`, `test/simple-scheduler.js`,
`test/scheduler-registry.js`, `test/app-config.js`).

**Trap:** the ordering of these two listeners is registration order, and the
config-cache eviction is what makes "edit `shiny-server-rules.config`, wait for
idle timeout, reload" work. Adding a listener that resurrects the scheduler
synchronously would break the eviction.

## `lib/globals.d.ts`

Declares the two ambient globals the `.ts` files rely on:
`SHINY_SERVER_VERSION` (a `var`, assigned in `lib/core/version.js`, read in
`lib/worker/app-worker.ts:571`) and `logger` (the log4js logger installed as a
global by `lib/core/log.js:23`). It also declaration-merges `eat()` and `done()`
onto Q's `Promise` class (see qutil above). `tsconfig.json` includes
`lib/**/*.ts`, so this file applies to all TypeScript in the project.

## Summary: dead or vestigial

- `qutil.withTimeout_p` and `qutil.fapply` — **removed**; they had no consumers.
- `paths.projectRoot` — exported; used only by `paths.js` itself and the test
  harness (`test/support/config.js`).
- `SimpleEventBus` — a bare `EventEmitter` subclass with an empty prototype
  block; only meaningful as a named type for one event.
- `lib/proxy/http.js` — requires `shutdown`, `AppSpec`, `Q`, `util` and `http`
  but reads none of them.

## Cross-cutting traps

1. **Implicit global installation.** Requiring `lib/core/log.js` installs
   `global.logger`; requiring `lib/core/qutil.js` installs `Promise.prototype.eat`.
   Modules use both without requiring either. `.mocharc.json` compensates for
   tests. Any new entry point must require both explicitly.
2. **Q is not a native promise.** `.fail` / `.fin` / `.eat` / `.invoke` /
   `.done` do not exist on native promises. Wrap with `Q.resolve()` at
   `.ts`↔`.js` boundaries.
3. **`_p` is the only signal.** Nothing else marks a `.js` function as async;
   preserve the suffix on new promise-returning functions.
4. **Sequential, not parallel.** `qutil.map_p` and `qutil.forEachPromise_p` both
   run one at a time by design (ordering matters for router precedence and for
   not fd-storming a directory). Don't "optimize" them into `Q.all`.
5. **Sync-in-name functions really are sync.** `directoryExistsSync` and
   `createPidFile` block the event loop; both are startup-only.
