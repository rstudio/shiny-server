---
title: Testing Guide
description: How Shiny Server is tested — the three tiers (unit tests in test/, the in-process integration harness in test/integration/ built on test/support/, and the real-R tier in test/integration-r/), the Mocha/Should.js/Sinon/Rewire conventions, what each file covers and the gaps that remain, the bit-rotted manual.test/ scripts, fixtures and tools/test-config.sh, Q-promise async conventions, and the traps (wrong Node ABI, ephemeral-port shadowing, socket pooling across recycled ports, no-op `.should.be.true`, root-only paths, fake timers vs. nextTick) to avoid when adding tests.
---

# Testing Guide

## Runner setup

There are three tiers, and **mocha is not recursive**, so every test directory has to
be named explicitly wherever tests are invoked:

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | `mocha test test/integration` — unit tests **and** the fast integration tier | nothing beyond `npm ci` |
| `npm run test:unit` | `mocha test` only | nothing |
| `npm run test:integration` | `mocha test/integration` only | nothing |
| `npm run test:r` | `mocha test/integration-r` — real R processes | R with the `shiny` package |

`test/support/` holds the harness and is deliberately *not* a test directory, so mocha
never loads it directly.

There is no watch mode, no coverage tooling, and no linting step. Two CI systems run
this: `.github/workflows/ci.yml` (Linux + macOS, plus a build-freshness check) and
Jenkins, which uses the vendored interpreter — `Jenkinsfile:108` runs
`./bin/node ./node_modules/mocha/bin/mocha test test/integration`.
**Keep that list of directories in sync with `package.json`'s `test` script**; a new
test directory that isn't added in both places silently doesn't run. (Note
`Jenkinsfile.internal:138` still runs `mocha test` only, so the internal build skips
the integration tier.)

**The real-R tier runs on GitHub Actions only.** The Jenkins images deliberately do not
install the `shiny` R package: Jenkins runs `mocha test test/integration`, never
`npm run test:r`, so provisioning R packages there would build a toolchain nothing
uses — and it broke the ubuntu-20.04 image, whose R falls back to compiling from
source, where `shiny -> bslib -> sass -> fs` needs libuv. Jenkins is expected to be
retired after the current round of refactors; don't add R provisioning back to it.

`.mocharc.json` auto-requires three modules before any test file, and sets a timeout
that a server boot can survive (mocha's 2s default cannot):

```json
{ "require": ["should", "./lib/core/log", "./lib/core/qutil"],
  "reporter": "spec", "timeout": 20000 }
```

Why each one is there:

- **`should`** — Should.js installs a `.should` getter on `Object.prototype`. It has
  to be loaded once, globally, before assertions like `merged.settings.appDefaults
  .initTimeout.should.equal(50)` will work. Several test files still `require('should')`
  themselves, but only because they need the *static* helpers (`should.not.exist(...)`);
  see the comments at `test/config-router-util.js:24` and `test/scheduler.js:22`.
- **`lib/core/log`** — production code calls a bare global `logger`, which this module
  installs (`lib/core/log.js:23`). Without the auto-require, essentially every module
  under `lib/` would throw `ReferenceError: logger is not defined` on first log call.
- **`lib/core/qutil`** — monkey-patches Q: it adds `.eat()` to `Q.makePromise.prototype`
  (`lib/core/qutil.js:20-22`). Production code calls `.eat()` on promises, so the patch
  must be installed globally, not per-test.

`lib/core/log.js:29` honors `SHINY_LOG_LEVEL`. The `app-worker` tests emit real INFO/ERROR
lines into the spec output; `SHINY_LOG_LEVEL=OFF npm test` silences that noise.

## Current real state of `npm test`

**310 passing, 0 failing, ~4s** on `master` (macOS, Node v24.20.0). `npm run test:r`
adds 8 more and takes about a second once R is warm.

The macOS-only `test/app-worker.js` failure (the `/blah` mkdir case returns `EROFS`
rather than `EACCES` on darwin) is fixed — the assertion now accepts either errno.

- **Node ABI trap (the first thing that bites).** `test/app-worker.js:19` requires
  `../build/Release/posix.node` directly, and `lib/core/fsutil.js` requires it
  transitively. If your shell's `node` is not ABI-compatible with whatever built
  `build/Release/`, mocha dies before running a single test with
  `ERR_DLOPEN_FAILED ... NODE_MODULE_VERSION`. Run tests with a Node matching
  `.nvmrc` (currently v24.20.0), or `npm rebuild` against the Node you're using.
  `nan` and `.nvmrc` move together for this reason: `nan` 2.20 does not compile
  against Node 24's V8 headers, so bumping one without the other fails in
  node-gyp before a single test runs.
- The `app-worker` block prints four log4js lines mid-spec about bookmark state
  directories under `$TMPDIR/app-worker-test-bookmarks`. Expected, not a failure.

## The integration harness (`test/support/`)

`test/integration/` boots a **real, complete server in-process** on an ephemeral port,
for each test, in about 15ms. Three modules make that possible:

- **`test/support/server.js`** — `start_p(configText, options)` resolves to a test
  server with `.port`, `.baseUrl`, `.get_p(path, init)`, `.workerEntries()` and
  `.stop_p()`. It is built on `lib/server-init.js`'s `createServer_p`.
- **`test/support/config.js`** — writes a throwaway config into a fresh temp dir,
  substituting `$USER` (the process user, which `run_as` must name), `$ROOT` (the
  checkout) and `$DIR` (that temp dir). `siteDirConfig(opts)` is the shape most tests
  want.
- **`test/support/fake-worker.js`** — `install()` replaces the
  `lib/worker/app-worker` module's `launchWorker_p` export with one that binds a real
  `http.Server` on the endpoint's port. Everything else stays live: the real
  `TcpTransport`, the real endpoint and shared secret, the real
  `connectEndpoint_p` handshake, the real proxy. Only `su` and R are skipped.

Pass `worker: false` to `start_p` to keep the real launcher and spawn actual R — that
is what `test/integration-r/` does.

### Why the seam is a module-export swap, not rewire

`lib/scheduler/scheduler.js:28` declares `let app_worker` specifically so rewire can
reach it, and `test/scheduler.js` uses that. The integration harness **cannot**: rewire
loads a second copy of the module, and the server built by `lib/server-init.js` would
still be using the first. What makes the plain assignment work is that
`scheduler.js:176` resolves `app_worker.launchWorker_p` as a property *at call time*.

Note also that `Scheduler.setTransport()` alone is not a sufficient seam:
`scheduler.js:171` calls `posix.getpwnam(appSpec.runAs)` and `:175` calls
`launchWorker_p` regardless of transport. That is why test configs must
`run_as $USER` — so the real `getpwnam` succeeds.

### Two traps that produced days of "impossible" flakiness

Both are recorded here because the symptoms point nowhere near the cause.

- **Ephemeral-port shadowing.** `TcpTransport.alloc_p` allocates a worker port by
  binding `127.0.0.1:0`, reading the port, and *closing again* (`lib/transport/tcp.js`).
  If a server listening on the wildcard `::` is started in that window, the kernel can
  hand it the very port that was just released; the stand-in worker then binds
  `127.0.0.1:<same port>`, **which succeeds** — a specific-address bind is permitted
  alongside a wildcard one — and from then on shadows the server for all loopback
  traffic. Requests silently reach the worker instead of Shiny Server, showing up as
  inexplicable 404s and `Parse Error: Expected HTTP/`. The harness avoids it by
  pinning the listener to `127.0.0.1` (`listen 0 127.0.0.1`), putting it in the same
  address space as the worker ports so the allocator won't double-assign.
- **Socket pooling across recycled ports.** `fetch()` pools keep-alive sockets per
  origin. Test servers are torn down and restarted milliseconds apart and ephemeral
  ports get recycled, so a pooled socket belonging to a dead server gets handed to the
  next test — which then talks to the *previous* test's config. `Connection: close` is
  not a fix: fetch treats `Connection` as a forbidden header and drops it silently.
  The harness therefore uses `http.request` with `agent: false`, one connection per
  request. It also destroys established connections at teardown, because
  `Server#destroy()` deliberately does not (see `requestLifecycle.md`).

## Testing patterns in use

### Should.js assertions

Idiomatic style is `value.should.equal(x)` / `.eql(x)` / `.have.keys(...)` /
`.containEql(...)`. `test/app-config.js` is the cleanest example. Static helpers
(`should.not.exist(x)`) appear at `test/config-router-util.js:151-152`.

Newer files skip Should.js entirely and use Node's `assert` — `test/iputil.js` and
`test/app-worker.js` are fully `assert`-based. Both styles are acceptable; prefer
`assert` for new tests, since it fails loudly (see the trap below).

### Sinon: spies, stubs, fake timers

- **Spies on real prototypes**: `test/scheduler-registry.js:45` spies
  `SimpleScheduler.prototype.acquireWorker`, then `resetHistory()` in `afterEach`
  (`:49-51`).
- **Stubs with per-argument behavior**: `test/render.js:58-59` stubs a hand-rolled
  `mockFS` object, then programs it per path (`existsStub.withArgs(PATH+'error.html')
  .returns(true)`).
- **Stubs with per-call behavior**: `test/app-worker.js:144-172` — `mock_spawn.callsFake(...)`
  for the general case plus `mock_spawn.onCall(0).callsFake(...)` for the first
  (log-creating) spawn when `logAsUser` is on.
- **Fake timers**: always pass `toNotFake`. Q resolves promises via `process.nextTick`,
  and since Sinon 19 / fake-timers 13 `useFakeTimers()` fakes `nextTick` and
  `queueMicrotask` by default — which would stall every Q promise until you call
  `clock.tick()`. The correct incantation, documented in a comment at
  `test/scheduler.js:44-49` and repeated at `test/robust-sockjs.js:59`:

  ```js
  clock = sinon.useFakeTimers({toNotFake: ['nextTick', 'queueMicrotask']});
  ```

### Rewire — the distinctive pattern here

Most modules in `lib/` `require()` their collaborators at module top level and hold
them in file-scope `var`s. There is no DI container and no constructor injection for
these. `rewire` is how the tests reach in and swap them. The shape is always:

```js
var rewire = require("rewire");
var Scheduler = rewire('../lib/scheduler/scheduler.js');   // instead of require()
Scheduler.__set__("app_worker", { launchWorker_p: function() { /* fake */ } });
```

Real uses, each worth reading:

- `test/scheduler.js:25,30-36` — replaces the whole `app_worker` module so the scheduler
  never spawns R; the fake returns a handle with `kill`, `getExit_p`, `isRunning`.
- `test/scheduler-registry.js:20,29` — replaces the `SimpleScheduler` constructor with a
  stub class so registry bookkeeping can be tested without a real scheduler.
- `test/nested-locations.js:21,25` — `config_router.__set__("checkPermissions", function() {})`.
  This is the canonical "escape a root-only check" move: real permission validation
  would require running the suite as root.
- `test/render.js:20,39` — replaces `fs` wholesale with a mock object, then Sinon-stubs
  that object's methods.
- `test/app-worker.js:11,31-36` — the most careful version: uses `__get__("child_process")`
  to read the real module, spreads it into a new null-prototype object, and overrides
  only `spawn`. This keeps every other `child_process` function intact.

**Reach for rewire when** the thing you need to fake is a module-level `require` in the
unit under test and there's no seam to inject through. **Don't** reach for it when the
collaborator is already a constructor argument (e.g. the event bus — tests just pass a
real `new SimpleEventBus()`).

Known rewire limitation, documented in-place at `test/simple-scheduler.js:62-72`:
rewiring a prototype method doesn't take effect through `util.inherits()`, so
`SimpleScheduler` tests monkey-patch `scheduler.spawnWorker` on the instance instead.

### Async Q-promise conventions

Two idioms coexist.

1. **Legacy `done` callback + `.then(done, done)`** — the terminal `.then(done, done)`
   forwards success as `done()` and failure as `done(err)`. Often followed by `.done()`
   to make Q surface otherwise-swallowed rejections. `test/squash-run-as-router.js:30-36`
   is the compact example; `test/scheduler.js:69-85` the fuller one.
2. **`async`/`await`** — newer tests just `await` the Q promise (Q promises are
   thenable, so `await` works) or use `Q.nfcall` to promisify node-style callbacks.
   `test/config-router-util.js:169-184` and all of `test/app-worker.js` do this. Prefer
   this for new tests.

For rejection tests, the older style asserts inside the failure handler and matches the
message with a regex (`test/nested-locations.js:27-43`); the newer style uses
`try { await ...; assert.fail(...) } catch (ex) { assert.match(ex.message, /.../) }`
(`test/app-worker.js:404-410`).

## Coverage map (honest)

| Subsystem | Automated coverage |
|---|---|
| `lib/worker/app-worker.ts` | **Good.** `test/app-worker.js` (6 tests, 471 lines) — the best test in the repo. Mocks `child_process.spawn`, asserts the exact `su`/`R` argv, the exact JSON written to R's stdin, stderr→logfile capture, bookmark dir creation and 0700 mode, and four failure modes. |
| `lib/core/iputil.js` | **Good.** `test/iputil.js`, 7 tests, thorough edge cases (zones, v4-mapped v6, wildcards). |
| `lib/core/render.js` | **Good.** `test/render.js`, template-resolution fallback order and caching. |
| `lib/scheduler/*` | **Moderate.** `test/scheduler.js` (spawn bookkeeping, acquire/release, idle-kill timer), `test/simple-scheduler.js` (maxRequests semantics), `test/scheduler-registry.js` (per-appSpec scheduler lifecycle). All against mocked workers. |
| `lib/proxy/robust-sockjs.js` | **Moderate.** Reconnect/collision/disconnect-buffering. |
| `lib/config/app-config.js` | **Narrow.** Only `addLocalConfig` merge semantics. |
| `lib/router/config-router-util.js` | **Narrow.** Only `parseApplication`. |
| `lib/router/config-router.js` | **Narrow.** Only `createRouter_p` against 3 fixtures, with permission checks rewired out. |
| `lib/router/squash-run-as-router.js` | **Complete** (it's tiny). |
| `lib/proxy/http.js` | **Moderate.** `test/proxy-http.js` pins `httpListener`'s dispatch contract against a doubled router/registry: the strict `appSpec === true` check, the 404/500/503 paths, and the acquire/release accounting. `test/integration/proxy.js` covers the same ground against a live server. `test/proxy-events.js` separately greps `node_modules/http-proxy` for `.emit(` calls and diffs them against `knownEvents` (`lib/proxy/http.js:61`) — a canary for upstream event churn, not a behavior test. |
| `lib/config/lexer.js`, `parser.js`, `config.js`, `schema.js` | **Good.** `test/config-lexer.js` (33), `test/config-parser.js` (32, incl. `ConfigNode` inheritance and `search` ordering), `test/config-schema.js` (46, incl. the real `shiny-server-rules.config`). Ported and expanded from the `manual.test/` scripts. |
| `lib/core/qutil.js` | **Good.** `test/qutil.js` — `forEachPromise_p`, `map_p` sequencing, `serialized`, `wrap`, `.eat()`. |
| `lib/server-init.js`, the Express stack | **Moderate.** `test/integration/` — `__assets__` rewriting, static/`send` behavior, the proxy path, the access log, `X-Powered-By`. |
| `lib/server/server.js` | **Narrow.** Exercised by every integration test's startup and teardown; the `$close` leak has a direct regression test in `test/integration/harness.js`. |
| Third-party behavior guards | `test/http-proxy.js` (http-proxy must send `Connection: close` upstream), `test/config-router-util.js:166-184` (`fs.fchmod` must accept a string mode). Both exist because a silent upstream change would break production. |

**Zero automated coverage**, roughly in descending order of how much a test would be
worth:

- `lib/proxy/sockjs.js`, `lib/proxy/multiplex.js`, `lib/proxy/errorcode.js` — **now the
  highest-value gap.** The SockJS and WebSocket paths are the only major traffic route
  with no coverage at either tier. `test/support/fake-worker.js` already accepts an
  `onUpgrade` handler, so the harness is ready for it.
- `lib/router/directory-router.js`, `local-config-router.js`, `user-dirs-router.js`, and
  the combinators in `router.js` (`CompositeRouter`, `PrefixFilterRouter`, `RestartRouter`,
  `RedirectRouter`) — covered end-to-end by `test/integration/`, but not unit-tested;
  they are pure-ish functions that would be easy to test directly.
- `lib/transport/tcp.js`, `unix-socket.js`; `lib/worker/app-worker-handle.js`, `run-as.js`.
- `lib/main.js` (the CLI wrapper), `lib/core/permissions.js`, `fsutil.js`,
  `connect-util.js`, `url-util.js`, `python.ts`, `shutdown.js`.
- `src/launcher.cc`, `src/posix.cc` — the native code is exercised only incidentally.

## Fixtures

- **`test/configs/`** — `valid.config`, `bad1.config` (illegal `app_dir` inheritance),
  `bad2.config` (no hosting model). Consumed by `test/nested-locations.js` via
  `paths.projectFile('test/configs/...')`. Add a fixture here when you need to assert a
  parse/validation outcome, and use `testBadConfig(desc, file, /regex/)`
  (`test/nested-locations.js:27`) for the negative cases.
- **`test/configs/testapps.config.in`** — a *template*, not a fixture. `$USER` and
  `$ROOT` are substituted by `tools/test-config.sh`, which writes
  `/tmp/shiny-server-test/testapps.config` and then launches `bin/shiny-server` against
  it. That's the one-liner for bringing up a real server serving `test/apps/`:
  `tools/test-config.sh` (defaults to `testapps`).
- **`test/apps/01_hello/`** — a two-file R Shiny app (`ui.R` + `server.R`). It is used
  as an `appDir` that must *exist on disk* (`test/app-worker.js:237`); R is never
  actually run against it in the automated suite. It's also the app served by
  `tools/test-config.sh`.

## `manual.test/` — what it is and its current state

These are **not mocha tests**. They are standalone scripts you run by hand with
`./bin/node manual.test/<script>.js`; most either print output for a human to eyeball or
`assert()` at module top level and crash on failure. Nothing runs them in CI. Several
have bit-rotted.

| Script | Purpose | State (verified) |
|---|---|---|
| `test-config-lexer.js` | Top-level `assert()`s over the config lexer's character classification and tokenization. | **Ported** to `test/config-lexer.js`. Kept for reference only. |
| `test-config-parser.js` | Parses two snippets and `console.log`s the AST for eyeballing. Its "assertions" at lines 9-11 are bare expressions that assert nothing. | **Superseded** by `test/config-parser.js`. |
| `test-config-config.js` | Config + schema validation, incl. good/bad fixtures under `manual.test/config/`. | **Fails**, and it is the script that is wrong: it asserts `bad2.config` (`run_as;`) is rejected for "too few arguments", but the schema declares `param String users...` (`config/shiny-server-rules.config:6`), so zero args is legal. `test/config-schema.js` pins the correct behaviour ("lets a vararg match zero arguments"). **Superseded.** |
| `test-serialized.js` | Demonstrates `qutil.serialized()` by interleaving sleeps; verify by reading the printed ordering. Takes ~10s. | **Superseded** by `test/qutil.js`, which also pins the queued-caller defect below. |
| `test-proxy.js` | Stands up a `ShinyProxy` on :8001. | **Dead.** Requires `lib/worker/worker-registry` and `router.AutouserRouter`, neither of which exists anymore. |
| `test-worker-registry.js`, `test-worker-registry-leak.js` | Worker registry smoke test / memory-leak logger. | **Dead** — same missing `worker-registry` module; the leak script also wants `webkit-devtools-agent` and hardcodes `/Users/jcheng/...`. |
| `loadtest.js` | Real load generator: N concurrent sessions, each fetching the static asset set plus a websocket session. Usage: `./bin/node manual.test/loadtest.js <shiny-url> [session-count]` (default 200). Requires a **running** Shiny Server hosting `01_hello`. The websocket `init` message is hardcoded for that app; retarget by capturing a new init frame from Chrome devtools. `SHINY_SERVER=false` at the top switches it to a bare Shiny process. | Should work; needs a live server. |
| `loadtest-xhr.js` | Same idea via SockJS `xhr_streaming`/`xhr_send` instead of websockets, hardcoded to `http://localhost:3838/01_hello/`, 50 concurrent. | Needs a live server. |
| `phantomjs/*.js` | `loadtest.js`, `loadtest-user.js`, `loadtime.js` — browser-driven load and page-load timing, hardcoded to `localhost:3838`. | **Obsolete.** PhantomJS is dead and isn't a dependency. Treat as historical. |

**Prerequisites summary:** the config/qutil scripts need nothing but Node. The load
tests need a running server (via `tools/test-config.sh`) and therefore R installed.
Nothing in `manual.test/` needs root. Nothing in `test/` needs root either — by design,
see the `checkPermissions` rewire.

## Adding a test

- **Where**: a `.js` file directly in `test/` (no subdirectories are scanned — mocha is
  invoked as `mocha test`, non-recursive). Name it after the module under test:
  `lib/router/foo-router.js` → `test/foo-router.js`. Plain JS even when testing a `.ts`
  module — `test/app-worker.js` requires the compiled `lib/worker/app-worker` (run
  `npm run build` first).
- **Header**: copy the AGPL comment block from any existing test.
- **What to mock**: anything that spawns a process, touches a real user account, binds a
  privileged port, or calls into permissions. Use rewire for module-level `require`s;
  pass real `SimpleEventBus` instances (they're cheap and real).
- **What to run for real**: pure logic, config parsing, promise plumbing, and — as
  `test/http-proxy.js` shows — genuine loopback HTTP servers on high ports when you're
  pinning down third-party behavior.

### Traps

- **`.should.be.true` without parentheses asserts nothing.** In Should.js 13, `true`,
  `false`, and `empty` are *methods*. `x.should.be.true;` evaluates to a function and
  silently passes. `test/render.js:71,75-76` and `test/robust-sockjs.js:39` have this
  bug; `test/robust-sockjs.js:26,44` do it correctly with `()`. Verified empirically.
  Prefer Node's `assert` in new tests.
- **A `done` parameter on `describe`, not `it`.** `test/simple-scheduler.js:90` declares
  `describe('#acquireWorker()', function(done){` and the first test at `:91-98` takes no
  `done` but calls `.then(done, done)` — resolving `done` from the enclosing describe
  (which is `undefined`). The test finishes synchronously; its assertion is never
  awaited. If it ever *did* fail, `.done()` would rethrow asynchronously and get blamed
  on some later test.
- **Empty test bodies pass.** `test/simple-scheduler.js:195-197` is an unimplemented
  placeholder that reports green.
- **`beforeEach` ordering.** `test/simple-scheduler.js:60-86` constructs the scheduler at
  `:61` but doesn't assign `appSpec` until `:78`, so each scheduler is built with the
  *previous* test's appSpec. Harmless today because the constructor ignores it; don't
  copy the pattern.
- **Fake timers stall Q.** Always `toNotFake: ['nextTick', 'queueMicrotask']` (above).
- **Cross-test timer bleed.** `test/scheduler.js:119-125` has to `clock.tick(5500)` and
  `killSpy.resetHistory()` just to flush kill timers left pending by earlier tests,
  because the module-level `killSpy` is shared. Prefer per-test fakes.
- **Tests that would need root** are avoided, not skipped: rewire out the permission
  check (`test/nested-locations.js:25`) or accept the limitation and say so — see
  `test/app-worker.js:225-226`, which comments out an ownership assertion because
  `chown` fails as non-root.
- **Floating promises.** `test/app-worker.js:216` calls `assert.rejects(...)` without
  `await`; the assertion effectively doesn't run. Always `await` `assert.rejects`.
- **Hardcoded ports.** `test/http-proxy.js` binds 9111 and 9112. Pick unused ports if
  you add a network test.
