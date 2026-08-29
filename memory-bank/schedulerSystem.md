---
title: Scheduler System
description: How Shiny Server pools, spawns, health-tracks, reuses, and reaps R/Python worker processes — SchedulerRegistry keyed by AppSpec.getKey(), the Scheduler base class and SimpleScheduler subclass, WorkerEntry reference counting (httpConn/sockConn/pendingConn), acquire/release from the HTTP and SockJS proxies, app_idle_timeout / app_init_timeout / simple_scheduler maxRequests, OutOfCapacity 503s, and the known races around worker teardown.
---

# Scheduler System

The scheduler layer sits between the router chain (which produces an `AppSpec`)
and the proxy layer (which needs a live worker process to forward bytes to). Its
job: given an `AppSpec` and a hint about what kind of traffic this is, hand back
something the proxy can `acquire()`, wait on, and `release()`.

Four files, all in `lib/scheduler/`:

| File | Role |
| --- | --- |
| `scheduler-registry.js` | `AppSpec` key → `Scheduler` instance. One process-wide instance (`lib/server-init.js`). |
| `scheduler.js` | Base class. Owns the worker table, the spawn/launch/connect/reap machinery. |
| `simple-scheduler.js` | The only OSS subclass. Implements the *policy*: one worker per app, capacity check. |
| `worker-entry.js` | Per-worker bookkeeping: the promise, the three connection counters, the idle timer. |

## The central abstraction: what `getWorker` returns

`SchedulerRegistry.getWorker` (`lib/scheduler/scheduler-registry.js:66`) returns a
**`WorkerEntry`, synchronously** — *not* a promise, and *not* an
`AppWorkerHandle`. This is deliberate and load-bearing:

- The caller must be able to `acquire()` a reference *before* the process is up,
  so that a worker still initializing isn't reaped out from under the request.
- The capacity decision (503 or not) must be synchronous so the proxy can reply
  immediately. `SimpleScheduler.acquireWorker` **throws** `OutOfCapacityError`
  rather than rejecting a promise — hence the `try`/`catch` (not `.fail()`) at
  `lib/proxy/http.js:141-153` and `lib/proxy/sockjs.js:127-136`, both with a
  `//TODO: clean this up` admitting the awkwardness.

The actual process handle comes later via `workerEntry.getAppWorkerHandle_p()`
(`lib/scheduler/worker-entry.js:114`), which just returns the stored promise.

### Naming, for grep purposes

- `SchedulerRegistry.getWorker(appSpec, url, worker)` — registry level.
- `Scheduler`/`SimpleScheduler.acquireWorker(appSpec, url, worker)` — policy level.
- `Scheduler.spawnWorker(appSpec, workerData, preemptive)` — mechanism level.
- `WorkerEntry.acquire(connType)` / `.release(connType)` — refcount level.

The `_p` convention holds: only `getAppWorkerHandle_p` and the internal
`connectEndpoint_p` / `alloc_p` / `launchWorker_p` / `getExit_p` return promises.

## SchedulerRegistry

### Keying

The key is `appSpec.getKey()` (`lib/worker/app-spec.ts:31`), which is a
newline-joined concatenation of `appDir`, `runAs`, `prefix`, `logDir`, **and
`JSON.stringify(settings)`**. Consequences worth internalizing:

- **Any settings change produces a different key, hence a different scheduler,
  hence a fresh process.** The old scheduler keeps serving its existing sessions
  under the old key and is garbage-collected only when its last worker exits.
  This is how config reload gets "new sessions use new config, old sessions keep
  running" for free.
- `RestartRouter` (`lib/router/router.js:88-113`) stamps
  `appSpec.settings.restart` with the mtime of `$APPDIR/restart.txt`. Touching
  that file mutates the key, so the next request lands on a brand-new scheduler
  and a brand-new R process. That is the entire implementation of "touch
  restart.txt to restart an app."
- `runAs` may be an array (see `SquashRunAsRouter` in `lib/server-init.js`); it is
  stringified into the key by ordinary coercion.
- Keys are long strings containing serialized JSON. They are used as object keys
  in `map.create()` null-prototype objects (`lib/core/map.js`), which is why
  `__proto__`-shaped app dirs don't blow anything up.

### Creation and destruction

- Created lazily on first `getWorker` for a key
  (`lib/scheduler/scheduler-registry.js:68-75`). Always a `SimpleScheduler` in
  OSS — the registry has no scheduler-type dispatch.
- Destroyed by the `vacantSched` event on the shared event bus
  (`lib/scheduler/scheduler-registry.js:38-41`). The scheduler emits it itself
  when its worker table empties (`lib/scheduler/scheduler.js:186-189`).
  `AppConfig` listens to the same event to evict its per-app-config cache
  (`lib/config/app-config.js:28-30`), which is why the two caches stay coherent.
- The registry never iterates schedulers to expire them; there is no reaper
  thread. Cleanup is entirely event-driven off process exit.

### Transport injection

`setTransport` (`lib/scheduler/scheduler-registry.js:48`) fans out to all
existing schedulers *and* is re-called on every config load
(`lib/server-init.js`). Schedulers created before a transport exists would have
`this.$transport` undefined; `getWorker` guards with `if (this.$transport)`. In
practice `loadConfig_p` runs before the server accepts connections.

### Vestigial arguments

- `getWorker`'s third parameter `worker` is a worker ID from the `?w=` query
  string (`lib/proxy/http.js:118`). `SimpleScheduler.acquireWorker` ignores it;
  the doc comment at `lib/scheduler/scheduler-registry.js:63-64` says so
  explicitly. It exists for Shiny Server Pro's multi-worker schedulers.
- The third constructor argument `appSpec.settings.appDefaults.sessionTimeout`
  (`lib/scheduler/scheduler-registry.js:71`) is **not a real setting** — nothing
  in `lib/router/config-router-util.js` ever sets `sessionTimeout` — and
  `Scheduler`'s constructor only takes two parameters anyway. Dead code that the
  tests nonetheless mimic.

## Scheduler (base) vs SimpleScheduler

The split is mechanism vs. policy.

**`Scheduler` provides** (`lib/scheduler/scheduler.js`): the `$workers` table,
`setTransport`, `spawnWorker`, `getLogFilePath`, `shutdown`, `dump`. It is an
`EventEmitter` but emits nothing itself; it publishes `vacantSched` on the
injected `$eventBus` instead.

**A subclass must implement exactly one method: `acquireWorker(appSpec, url,
worker)`.** It picks from `this.$workers` or calls `this.spawnWorker(...)`, and
returns a `WorkerEntry` (or throws `OutOfCapacityError`). That is the whole
contract.

`SimpleScheduler` (`lib/scheduler/simple-scheduler.js:34-72`) is the only OSS
subclass, and it is deliberately trivial: **at most one worker per app.** It
takes `$workers[_.keys($workers)[0]]` if anything is there, otherwise spawns.
The base class is nevertheless written for N workers (random hex worker IDs,
a keyed table, `?w=` addressing, `workerData` passthrough) because Shiny Server
Pro layers utilization-based and multi-process schedulers on top of it. Nothing
resembling a utilization scheduler exists in this repo — do not go looking for
`utilization_scheduler`; it is a Pro directive only.

### The capacity policy

Read `lib/scheduler/simple-scheduler.js:40-67` carefully; the rules are:

1. `maxRequests` of `0` means `Infinity` (line 43-45). Default is `100`
   (`lib/router/config-router-util.js:154`, and the schema default at
   `config/shiny-server-rules.config:181`).
2. The quantity compared against the limit is `sessionCount()` =
   `sockConn + pendingConn` (`lib/scheduler/worker-entry.js:87`). **`httpConn` is
   not counted.** So `simple_scheduler maxRequests` caps *concurrent sessions*,
   not concurrent HTTP requests, despite the directive text calling them
   "requests."
3. If at capacity, traffic whose `url` is neither `'ws'` nor `'/'` is served
   anyway (line 53-56) — assets, images, and subpaths must not 503, or an
   already-connected user's page would break.
4. If at capacity and this is a SockJS connection (`url === 'ws'`) *and*
   `pendingConn > 0`, it is admitted up to `hardLimit + 1` (line 57-59). This is
   the reservation being redeemed; see below.
5. Otherwise throw `OutOfCapacityError` → 503 page for HTTP
   (`lib/proxy/http.js:147-151`), close code `OUT_OF_CAPACITY` for SockJS
   (`lib/proxy/sockjs.js:132-134`).

**Gotcha:** rule 3's test is `url !== '/'`, but the proxy treats an `.Rmd`/`.qmd`
path as an app page too (`lib/core/url-util.js:15-17`, used at
`lib/proxy/http.js:135`). So a request for `report.Rmd` at capacity takes branch
3 and is served, while still doing `acquire("pending")`. R Markdown apps can
therefore be admitted past `maxRequests`.

## Worker lifecycle

### Spawn (`lib/scheduler/scheduler.js:122-279`)

The ordering here is the subtle part:

1. Compute `idleTimeout` from `appSpec.settings.appDefaults.idleTimeout` (lines
   127-137), clamped to `2^31 - 1` ms because Node's `setTimeout` is 32-bit.
2. Construct the `WorkerEntry` around a *pending* deferred and **insert it into
   `$workers` synchronously** (lines 139-141), then `return workerEntry` at line
   278 — before any I/O has happened. This synchronous insertion *is* the promise
   cache: a second request arriving one tick later finds the entry via
   `acquireWorker` and waits on the same promise instead of spawning a duplicate.
3. `$transport.alloc_p()` picks a TCP port or Unix socket
   (`lib/transport/tcp.js:41`, `lib/transport/unix-socket.js:51`).
4. `posix.getpwnam(appSpec.runAs)` resolves the target user; `launchWorker_p`
   forks the process (`lib/worker/app-worker.ts`).
5. **Readiness is not "the process started" — it's "the port answers."**
   `connectEndpoint_p` (lines 56-109, called at 252) polls the endpoint on a
   fixed retry ladder `[50, 50, 100, 100, 100, 100, 100, 200, 200, 300, 300,
   300]` ms, then every 500 ms, up to `initTimeout` (default 60 s, from
   `app_init_timeout`). Its `shouldContinue` callback is `exitPromise.isPending`,
   so if the process dies mid-startup, polling aborts immediately rather than
   burning the full timeout.
6. On connect, `workerEntry.startIdleTimer()` fires (line 259) *before* the
   deferred resolves. This is intentional: a worker that spins up and is never
   used must still be reaped.
7. `defer.resolve(appWorkerHandle)`.

Failure at any step routes through `doReject` (lines 144-151), which stamps
`err.consoleLogFile = logFilePath` (so the 500 page can tail the R stderr — see
`lib/proxy/http.js:216`) and **removes the entry from `$workers`**, so the next
request retries from scratch.

`doReject` is nulled out once the deferred settles (lines 158-162) to break a
retain cycle. The comment there is jcheng's own 2013 note that the leak may no
longer exist; it has never been re-verified.

### There is no exponential backoff

`CLAUDE.md` claims the scheduler "handles spawning with exponential backoff."
**It does not.** A repo-wide grep for `backoff` matches only that sentence in
`CLAUDE.md`. The only escalating-interval logic anywhere in the scheduler is the
connect *retry ladder* in `connectEndpoint_p` (line 60), which governs polling a
port on a process we already launched — not re-launching after a crash.

There is no failure counter and no cooldown. Since `doReject` deletes the entry,
every single incoming request to a persistently-broken app spawns a fresh
process, waits for it to die or time out, and returns a 500. A crash-looping app
under load will fork one R process per request. If you are debugging "why is this
box forking hundreds of R processes," this is why.

### `AppWorkerHandle`

`lib/worker/app-worker-handle.js` is a 40-line value object: `appSpec`,
`endpoint`, `logFilePath`, `exitPromise`, and a `kill` function bound to the
underlying `AppWorker` (`lib/scheduler/scheduler.js:228-230`). It carries no
counters — all reference counting lives in `WorkerEntry`.

Two fields are attached *from outside* and are not declared in the constructor:
`appWorkerHandle.proxy`, an `http-proxy` instance memoized per worker at
`lib/proxy/http.js:184-193` and closed on exit. Treat the handle as an open
struct.

`kill(force)` (`lib/worker/app-worker.ts:520`) sends SIGINT and escalates to
SIGTERM after 20 s; `force = true` sends SIGTERM straight away.

## Reference counting (`worker-entry.js`) — read this twice

Three counters, all on `this.data` so they show up in `dump()`:

| Counter | Incremented by | Decremented by |
| --- | --- | --- |
| `httpConn` | `lib/proxy/http.js:156` for every proxied HTTP request | `res` `finish`/`close`, via `_.once` cleanup at `lib/proxy/http.js:161-173` |
| `sockConn` | `lib/proxy/sockjs.js:148` on SockJS open | `conn` `close`, `_.once` (`lib/proxy/sockjs.js:149-152`) |
| `pendingConn` | `lib/proxy/http.js:158`, only when `isAppPagePath(pathname)` | `lib/proxy/sockjs.js:146`, or a timer |

`pendingConn` is the interesting one, and the 30-line comment at
`lib/scheduler/worker-entry.js:54-84` is the authoritative explanation. The
short version: serving an app page (`/` or `*.Rmd`) is strong evidence a SockJS
session is about to open, so we **reserve a session slot up front**. The
reservation is taken as request processing *begins*, not ends, so that a burst of
page loads 503s immediately instead of admitting 500 pages we can't serve
sessions for.

Reservations must not leak, so:

- If the app page response was not 2xx (`res.proxySuccess`, set at
  `lib/proxy/http.js:253`), the reservation is released immediately
  (`lib/proxy/http.js:164-167`).
- If it succeeded, a **45-second** `pendingReleaseTimer` is pushed
  (`lib/proxy/http.js:171`) — a hardcoded constant, not configurable — so a
  SockJS connection that never arrives (proxy/firewall/JS failure) doesn't pin
  the worker forever.
- When a SockJS connection does arrive, the proxy must do **both**
  `shiftPendingReleaseTimer()` and `release("pending")`
  (`lib/proxy/sockjs.js:145-146`). The timers are a FIFO queue and the *oldest*
  is cancelled — there is no matching of a specific HTTP request to a specific
  SockJS connection, only counting.

Invariants and traps:

- `release("pending")` when `pendingConn` is already 0 logs and **returns early
  without calling `startIdleTimer()`** (`lib/scheduler/worker-entry.js:131-135`).
  This is safe today only because every caller of `release("pending")` on that
  path immediately does `acquire("sock")` afterward. A future caller that
  releases a phantom pending as its last act would leave the worker with all
  counters at zero and *no idle timer running* — i.e. never reaped.
- `httpConn` and `sockConn` underflow is clamped with `Math.max(0, ...)` (lines
  126, 129) rather than throwing, so an unbalanced `release` silently corrupts
  the count instead of surfacing.
- Both proxies wrap their release in `_.once` and subscribe to *two* events
  (`finish` and `close`) precisely because either can fire. `_.once` is what
  makes acquire/release balance.
- `acquire()` clears the idle timer (lines 108-111) but does **not** touch
  `pendingReleaseTimers`.
- `release()` unconditionally calls `startIdleTimer()` (line 146); the guard
  "are all three counters zero?" lives inside `startIdleTimer`
  (`lib/scheduler/worker-entry.js:150`).
- In `lib/proxy/sockjs.js` the order is `release("pending")` *then*
  `acquire("sock")`. If the pending reservation was the last reference, an idle
  timer starts and is cancelled microseconds later by the `acquire`. Correct, but
  fragile if anyone reorders those two lines.

### Idle timeout and reaping

`startIdleTimer` (`lib/scheduler/worker-entry.js:149-162`) arms a timer that
emits `"idletimeout"`. The single listener is installed in the scheduler
(`lib/scheduler/scheduler.js:232-245`): it sets `deleteLogFileOnExit = true` and
calls `appWorker.kill()`.

- Default idle timeout is **5 seconds** (`lib/scheduler/scheduler.js:127` and
  `lib/router/config-router-util.js:57`). Yes, five — Shiny Server is
  aggressive about reclaiming idle R processes.
- `idleTimeout <= 0` disables reaping entirely (line 151, with an explicit
  "refusing to reap" trace). The `app_idle_timeout` docs say "Set to 0 to
  disable"; the scheduler's own warning at `lib/scheduler/scheduler.js:134`
  instead suggests a *negative* value. Both work.
- Log files of cleanly-reaped workers are deleted
  (`lib/scheduler/scheduler.js:193-224`) unless `preserve_logs` is on; logs of
  workers that died some other way are kept, which is the whole point. When
  `log_as_user` is set the deletion is done by spawning `rm` as that user, since
  the server process may not be able to unlink it.

## Health tracking and crash handling

There is **no active health checking** — no heartbeat, no probe, no "unhealthy"
flag. A worker is in `$workers` and therefore usable, or it is gone. Exactly two
things remove it:

1. `doReject` — failed to start (`lib/scheduler/scheduler.js:146-149`).
2. `exitPromise.fin` — the process exited, for any reason
   (`lib/scheduler/scheduler.js:180-192`). This calls `workerEntry.close()`,
   deletes the entry, frees the endpoint, and emits `vacantSched` if the table is
   now empty.

`WorkerEntry.close()` (`lib/scheduler/worker-entry.js:192-197`) sets
`closed = true` and drains the pending-release timer queue. `release()`
short-circuits on `closed` (line 119), so in-flight proxies calling `release`
after the process died are harmless no-ops. This is the mechanism that makes it
safe for the proxies to hold a `WorkerEntry` reference indefinitely.

In-flight connections are *not* proactively closed by the scheduler. The proxy
layer handles that: `appWorkerHandle.exitPromise` closes the memoized HTTP proxy
(`lib/proxy/http.js:188-193`), and the SockJS side detects `wsClient.onclose`,
tails the log file, and reports the crash to the browser
(`lib/proxy/sockjs.js:191+`).

### The known race: kill() ≠ removal

The entry is deleted when the process **exits**, not when it is **killed**.
Between the idle-timeout `kill()` (SIGINT) and the actual exit — up to 20 s
before SIGTERM escalation — `SimpleScheduler.acquireWorker` will happily hand
that dying worker to a new request. `test/simple-scheduler.js` has an *empty*
test body acknowledging this:

```js
it('should not assign traffic to a kill()ed worker before the process exits', () => {
});
```

In practice the window is usually small because the R process exits promptly on
SIGINT, and a request arriving during it will `acquire()` — but the `acquire()`
happens after the kill was already sent, so it does not save the process. The
user sees a session that dies immediately.

## Shutdown and diagnostics

- `Scheduler.shutdown` (`lib/scheduler/scheduler.js:292-302`) iterates workers
  and calls `kill(true)` (SIGTERM) — but **only for workers whose promise
  `isFulfilled()`**. A worker still in its startup/connect phase is skipped and
  is orphaned when the server exits. Same blind spot in `dump()`, which prints
  `[unresolved promise]` (line 320).
- `lib/main.js` calls `schedulerRegistry.shutdown()` on SIGINT/SIGTERM/
  SIGABRT and waits 500 ms before `process.exit`.
- `SIGUSR1` dumps the worker table to the log (`lib/main.js` →
  `Scheduler.dump`, `lib/scheduler/scheduler.js:312`). Useful for "which workers
  are alive and where are their logs" in production.
- `SIGHUP` reloads config (`lib/main.js`). Note it does **not** touch the
  registry: existing schedulers keep running; new settings produce new keys and
  therefore new schedulers on the next request.

## Config directives

All defined in `config/shiny-server-rules.config` and parsed by
`lib/router/config-router-util.js:50-155`. Defaults are applied only when
`provideDefaults` is true (the global config pass), so a per-app
`shiny-server-rules.config` overlay merges onto whatever the global pass
produced.

| Directive | Effect | Default | Read at |
| --- | --- | --- | --- |
| `app_idle_timeout <seconds>` | Reap an unused worker after N seconds. `0` or negative disables. | 5 | `lib/scheduler/scheduler.js:127-137` |
| `app_init_timeout <seconds>` | Give up waiting for the worker's port to answer. | 60 | `lib/scheduler/scheduler.js:247-250` |
| `simple_scheduler [maxRequests]` | Max concurrent *sessions* per app; `0` = unlimited. | 100 | `lib/scheduler/simple-scheduler.js:41-42` |
| `preserve_logs` | Keep the log file of a cleanly-reaped worker. | false | `lib/scheduler/scheduler.js:200-201` |
| `allow_app_override` | Whether an app's own config may override scheduler settings. | true | `lib/router/local-config-router.js` |

Two constants that look configurable but are not: the 45 s pending-release timer
(`lib/proxy/http.js:171`) and the 20 s SIGINT→SIGTERM escalation
(`lib/worker/app-worker.ts:546`, with its own `TODO: Should this be
configurable?`).

## Testing notes

- `test/scheduler.js` requires the compiled native module (`build/Release/posix`,
  pulled in at `lib/scheduler/scheduler.js:29`), so it cannot run without
  `node-gyp` output present. It `rewire`s `app_worker` — which is why
  `scheduler.js:28` declares it with `let` rather than `const`, with a comment
  saying exactly that. Don't "modernize" that line.
- `test/scheduler.js` uses `sinon.useFakeTimers({toNotFake: ['nextTick',
  'queueMicrotask']})` because Q resolves via `process.nextTick`; faking it
  deadlocks every promise in the suite.
- `test/simple-scheduler.js` monkey-patches `scheduler.spawnWorker` on the
  instance rather than via rewire, with a comment explaining that rewire doesn't
  reach through `util.inherits`. Its `addWorker` helper builds a duck-typed
  worker that borrows `WorkerEntry.prototype.sessionCount` — a good reminder that
  the only thing `acquireWorker` needs from an entry is `sessionCount()`,
  `data`, and `getAppWorkerHandle_p()`.
- `test/scheduler-registry.js` stubs `SimpleScheduler` via rewire and asserts the
  `vacantSched` deletion path directly.
