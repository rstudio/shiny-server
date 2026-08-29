---
title: Proxy Layer
description: How Shiny Server moves bytes between browsers and worker processes — ShinyProxy/http-proxy-3 for plain HTTP, the SockJS server (native WebSocket + XHR/streaming/polling fallbacks) relayed to workers as faye-websocket clients, the robust-sockjs reconnection state machine, the multiplex channel protocol, SockJS close codes in errorcode.js, connection accounting (acquire/release of http/sock/pending), injected headers (shiny-shared-secret, x-frame-options), and the error pages users see.
---

# Proxy Layer

Covers `lib/proxy/*` plus the parts of `lib/main.js` and `lib/transport/*` needed to
understand how a request gets from the browser to an R/Python worker and back.

## The shape of the thing

Shiny Server terminates browser connections in its own Node process, then opens a
*separate* connection to a worker process for each one. There are exactly two kinds
of upstream connection:

1. **HTTP** — proxied by `http-proxy` (`lib/proxy/http.js`), one `ProxyServer`
   instance cached per worker.
2. **WebSocket** — a `faye-websocket` client created by the transport endpoint
   (`lib/transport/tcp.js:123`), one per Shiny session.

Everything the browser does maps onto one of those two. Notably there is **no raw
WebSocket proxying**: `http-proxy`'s `proxy.ws()` is never called anywhere in the
codebase (the only mention of `proxyReqWs` is in the `knownEvents` list at
`lib/proxy/http.js:66`). Browser WebSockets are terminated by the SockJS server
(`server.on('upgrade')` → `sockjsHandler.upgrade` at `lib/server-init.js`), and the
worker-side WebSocket is a brand-new client connection. So "native WebSocket" and
"SockJS fallback" are not two code paths in Shiny Server — they're two SockJS
*transports* that converge on the same `lib/proxy/sockjs.js` code.

```
browser --HTTP------------> express (main.js) --> ShinyProxy.httpListener --> http-proxy --> worker :port
browser --WS upgrade------> sockjs server (upgrade handler)  \
browser --xhr/polling/...-> sockjs server (express middleware)/ --> RobustSockJS --> MultiplexSocket --> faye ws client --> worker :port/websocket/
```

## ShinyProxy (`lib/proxy/http.js`)

Constructed once in `lib/server-init.js` with `(metarouter, schedulerRegistry)` and
installed as the last express middleware (`lib/server-init.js`). It is not really a
class — all the behavior lives in the closure-scoped `httpListener`
(`lib/proxy/http.js:93-227`); the prototype block at `lib/proxy/http.js:281-283` is
empty.

Per-request flow (`lib/proxy/http.js:93-227`):

1. `req.pause()` immediately (`:97`) so no body bytes are lost while the router is
   consulted asynchronously; `req.resume()` only after `proxy.web()` is called
   (`:208`).
2. `router.getAppSpec_p(req, res)` → `AppSpec` | `true` (router already responded) |
   falsy (404). Also re-checks `req.socket.writable` after every await point
   (`:104`, `:179`) — a cheap guard against doing work for a hung-up client.
3. Strip `appSpec.prefix` from `req.url` (`:123-131`). A router that returns a prefix
   that isn't actually a prefix of the URL is treated as a bug and 404s (`:123-127`).
4. `schedulerRegistry.getWorker(appSpec, pathname, worker)` (`:144`) — **synchronous**,
   returns a `WorkerEntry`, and throws `OutOfCapacityError` → 503 page (`:147-151`).
   The try/catch is deliberate and commented: returning a rejected promise here used
   to escape the chain as an unhandled exception (`:138-140`).
5. Acquire refcounts (see below), register `cleanup` on `res` `finish`/`close`.
6. `wrk.getAppWorkerHandle_p()` → lazily create + cache `appWorkerHandle.proxy`
   (`:184-193`), inject the shared secret header (`:204`), `proxy.web(req, res)`.

`worker` comes from the **query string** (`qs.parse(req._parsedUrl.query).w`,
`:117`). It's forwarded to the scheduler but `SimpleScheduler.acquireWorker` only
accepts `(appSpec, url)` (`lib/scheduler/simple-scheduler.js:34`), so in the
open-source build it is silently ignored. Its presence still matters: `!worker` is
part of the `isAppPage` test (`:136`).

### The per-worker proxy object

`createHttpProxy` (`lib/proxy/http.js:234-278`) makes one `createProxyServer` per
`AppWorkerHandle`, targeting `endpoint.getHttpProxyTarget()` (`{host, port}` for TCP,
`{host, socketPath}` for unix sockets). The comment at `:229-233` explains why it
isn't a shared routing proxy: node-http-proxy's `RoutingProxy` leaked proxies forever.
The proxy is closed from `appWorkerHandle.exitPromise` (`:187-192`), which is the only
thing keeping this from leaking a proxy per worker.

`proxy.emit` is monkey-patched (`:241-248`) to log every event and `logger.warn` on
anything not in `knownEvents` (`:61-67`). `test/proxy-events.js` greps
`node_modules/http-proxy` for `.emit(` and fails if the sets diverge — this exists
because the upstream library has repeatedly renamed its events. The list is
`open, close, proxyReq, proxyRes, proxySocket, start, end, error, econnreset,
proxyReqWs`.

Two handlers are attached:

- `proxyRes` (`:252-259`) — sets `res.proxySuccess` (2xx) for the pending-connection
  accounting, and applies the configured `x-frame-options` response header.
- `error` (`:261-266`) — renders the 500 page. Note it passes `req.templateDir`, which
  is attached by `ServerRouter` at `lib/router/config-router.js:339`, *not*
  `appSpec.settings.templateDir`.

### Version-sensitive notes

- **Keepalive to the worker is off.** The proxy sets `outgoing.agent = false` and
  therefore forces `connection: close` upstream. `test/http-proxy.js` asserts exactly
  this, with a comment explaining why: httpuv ≤ 1.3.6 didn't clear headers between
  keepalive requests on the same socket. If that test ever fails, Shiny Server must add
  its own header munging.
- `isKeepalive` and `stripConnectionHeaders` used to sit at the bottom of
  `lib/proxy/http.js`, called by nothing and exported by nothing; they have been
  **removed**. The `shutdown`, `AppSpec`, `Q`, `util` and `http` requires at the
  top of the file are still unused.

#### `http-proxy` → `http-proxy-3`

`node-http-proxy` was unmaintained (last release 1.18.1, May 2020). It has been
replaced with `http-proxy-3`, an API-compatible maintained fork (1.23.x):

- `http-proxy-3` **does not emit `proxySocket`**, so it is gone from `knownEvents`;
  the remaining nine names match its emit set exactly.
- It keeps `outgoing.agent = false`, so the keepalive behavior above is unchanged
  (`node_modules/http-proxy-3/dist/lib/http-proxy/common.js:96-106`).
- It has a **second, `fetch`-based streaming path** (`stream2` in
  `passes/web-incoming.js:184`), taken only when `options.fetch`,
  `options.fetchOptions`, or `FORCE_FETCH_PATH=true` is set. Shiny Server sets none of
  those, so the classic `http.request` path stays in force. Don't enable it casually;
  the `proxyRes`/`error` event shapes differ.
- The comment at `lib/proxy/http.js:205-206` ("we will null out req and res in the
  proxy") **becomes stale** under the fork: `http-proxy-3` does not null `req`/`res`,
  and grep finds no `req = null` in the package. Unverified for `http-proxy` 1.x, so
  the comment may still be accurate today.

## Headers

What actually crosses the proxy boundary, verified rather than assumed:

| Header | Direction | Where |
|---|---|---|
| `shiny-shared-secret` | to worker (HTTP) | `lib/proxy/http.js:204` |
| `shiny-shared-secret` | to worker (WS) | `lib/transport/tcp.js:127`, `lib/transport/unix-socket.js:103` |
| `connection: close` | to worker | forced by http-proxy (agent=false) |
| `x-frame-options` | to browser | `lib/proxy/http.js:257`, from `appDefaults.frameOptions` |
| `X-Powered-By: <serverName>` | to browser | `lib/server-init.js` (express's own is disabled) |
| `session_state` cookie | to browser | `client-sessions` middleware, `lib/server-init.js,170` |

**There are no `X-Forwarded-*` headers.** `http-proxy` only adds them when
`options.xfwd` is set (`passes/web-incoming.js:72`), and Shiny Server never sets it.
Everything else in `req.headers` is forwarded verbatim (minus `trailer`), including
`Host` and cookies.

The shared secret is per-`Endpoint` random 16 bytes (`lib/transport/shared.js:22`); it
exists so a worker listening on `127.0.0.1:<port>` only answers the server that
spawned it. There is no `Shiny-Server-*` header — the equivalent information
(`workerId`, `mode`, `disableProtocols`, `reconnect`, `sanitizeErrors`, …) is handed
to the worker once at spawn time as JSON on stdin (`lib/worker/app-worker.ts:560-592`),
and the R side injects it into the page for `shiny-server-client` to read.

**Surprise:** the `client-sessions` middleware is applied to upgrade requests as
`clientSessionMiddleware(request, null, cb)` (`lib/server-init.js`). With `res === null`
the `Session` constructor throws on `res.socket`
(`node_modules/client-sessions/lib/client-sessions.js:378`), the library catches it and
calls `next(err)` on `process.nextTick`, and `lib/main.js` ignores the error argument.
Verified empirically. So WebSocket upgrades work, but only by accident, and one tick
later than they look. Also, nothing in `lib/` ever *reads* `req.session_state`; the
middleware appears vestigial.

## Connection accounting (get this right)

Three independent counters live on `WorkerEntry` (`lib/scheduler/worker-entry.js`):
`httpConn`, `sockConn`, `pendingConn`. Invariants:

- `sessionCount() = sockConn + pendingConn` (`worker-entry.js:87-89`) — this is what
  `SimpleScheduler` compares against `simple_scheduler maxRequests` (default 100).
- The idle-reap timer starts only when **all three** are zero
  (`worker-entry.js:150-161`). `acquire()` cancels any running idle timer
  (`worker-entry.js:108-111`).
- `release()` is a no-op once the entry is `closed` (`worker-entry.js:119-122`), and
  `release("pending")` on a zero count logs and returns rather than going negative
  (`worker-entry.js:131-135`). `http`/`sock` are floored at 0.

### http

`wrk.acquire("http")` at `lib/proxy/http.js:156`, released by the `_.once`-wrapped
`cleanup` registered on both `res.on("finish")` and `res.on("close")`
(`lib/proxy/http.js:161-176`). Both events are registered because either can be the
one that fires; `_.once` makes the pair idempotent.

### pending — the reservation mechanism

The tricky one. Rationale is written out at length in `worker-entry.js:54-84`; the
short version: an HTTP request for an *app page* is a strong predictor that a SockJS
session is about to arrive, so we reserve capacity for it up front rather than letting
100 people load the page and then discover there's no room.

- "App page" = `url_util.isAppPagePath(pathname)`, i.e. exactly `/` or a path ending
  in `.rmd`/`.qmd` (case-insensitive) — `lib/core/url-util.js:14-16` — *and* no `w`
  query param (`lib/proxy/http.js:136`).
- `wrk.acquire("pending")` happens at request *start* (`lib/proxy/http.js:157-159`),
  not at completion, deliberately.
- At `cleanup` (`lib/proxy/http.js:161-174`): if `res.proxySuccess` is falsy, release
  immediately (no session is coming). If truthy, don't release — instead
  `pushPendingReleaseTimer(45 * 1000)`, a FIFO queue of timers that will release the
  reservation if the SockJS connection never shows up.
- On the SockJS side, `lib/proxy/sockjs.js:145-146` does
  `shiftPendingReleaseTimer(); release("pending");` — cancel the *oldest* timer and
  redeem one reservation. There is no matching of a specific request to a specific
  connection; it's a bare counter.

**Gotcha:** the 45s pending timeout in `lib/proxy/http.js:171` is hardcoded, unrelated
to any config directive.

**Gotcha:** `SimpleScheduler`'s capacity check special-cases only `url === 'ws'` and
`url === '/'` (`lib/scheduler/simple-scheduler.js:53`), while `isAppPagePath` also
counts `.Rmd`/`.qmd`. So an `.Rmd` request acquires a `pending` reservation but is
*not* subject to the `maxRequests` gate, and can push `sessionCount()` past the limit.

**Gotcha:** every SockJS connection runs the shift+release, including subapp channels
that never had a matching app-page request. That's why `release("pending")` tolerates
underflow.

### sock

`wrk.acquire("sock")` at `lib/proxy/sockjs.js:148`, released from an `_.once`'d
`conn.on("close")` (`:149-152`). The `conn` here is a **MultiplexChannel**, so the
count is per Shiny session, not per browser tab's transport. Because the channel's
`close` is only emitted after `RobustConn` stops withholding it (see below), a
disconnected-but-resumable session keeps holding its `sock` count for the robust
timeout — which is exactly the behavior the `reconnect` config directive documents.

## SockJS server (`lib/proxy/sockjs.js`)

Created lazily, after the config is parsed (`lib/server-init.js`), because the
heartbeat/disconnect delays are config-driven. Two entry points into the same server:
the express middleware (`lib/server-init.js`, returns truthy if it handled the
request) and the `upgrade` handler (`lib/server-init.js`).

The SockJS `prefix` is the regex `.*/__sockjs__(/[no]=\w+)?`
(`lib/proxy/sockjs.js:42`) — deliberately greedy, so *any* URL containing
`/__sockjs__` anywhere is captured regardless of which app prefix or path params
precede it. Defaults: heartbeat 25s, disconnect delay 5s
(`lib/proxy/sockjs.js:26-33`, matching `lib/router/config-router.js:121-129`).

The connection pipeline is three layers deep, outermost first:

```
sockjs Connection  →  RobustConn (adds "<hexId>#" framing, survives transport loss)
                   →  MultiplexChannel (adds "<chanId>|m|" framing)
                   →  connectToApp() → faye-websocket client → worker
```

`sockjsServer.on('connection')` (`:49-55`) robustifies, then wraps in a
`MultiplexSocket`, then handles each channel. **If `robustify` returns falsy (a
reconnect), no new `MultiplexSocket` is created** — the existing one is still attached
to the still-live `RobustConn`, which is the entire point of the design.

`connectToApp` (`:100-251`):

- Buffers inbound `data` events in `connEventQueue` until the upstream WebSocket
  opens, then swaps the handler for a direct `wsClient.send` bind and replays the
  queue (`:169-179`). Note the replay uses `conn.emit('data', ...)`, i.e. it goes back
  through the (now-rebound) listener.
- Also uses the `pause` npm module around `getAppSpec_p`
  (`lib/proxy/sockjs.js:74, 92-96`) for the same reason `req.pause()` exists on the
  HTTP side.
- Worker URL: `conn.url` minus the app prefix, with `/__sockjs__/.*` rewritten to
  `/websocket/` (`:159-167`). For subapp channels the client-supplied relative URL
  already ends in `/__sockjs__/` (`shiny-server-client/lib/subapp.js:17`), so the same
  rewrite works.
- `getWorker(appSpec, 'ws')` (`:129`) — the literal string `'ws'` stands in for a URL,
  and `SimpleScheduler` keys its capacity logic off that sentinel.
- Server-side enforcement of `reconnect false`: if the app disallows reconnect but the
  client asked for a robust connection, close with `ACCESS_DENIED`
  (`:85-89`). (The primary enforcement is client-side, via the `reconnect` flag passed
  to the worker at spawn.)

### Worker death → browser

`wsClient.onclose` (`:191-237`) is the crash-reporting path. If the browser side is
already closing, stay quiet. Otherwise tail 8KB of the worker's log
(`fsutil.safeTail_p`) and, unless `sanitizeErrors` is set, push it to the browser as
a `{custom: {console: ...}}` message (`lib/core/render.js:96-103`) followed by a
`{custom: {alert: ...}}` message (`:110-117`) that Shiny renders as a JS alert. Then
close with `SHUTTING_DOWN` or `APP_EXIT`.

## robust-sockjs (`lib/proxy/robust-sockjs.js`)

**Problem it solves:** a SockJS transport can die (laptop sleeps, wifi drops, a proxy
kills a long-poll) without the Shiny session being dead. `RobustConn` is a stable
handle whose underlying SockJS connection can be swapped out, so the R session and the
worker-side WebSocket never notice.

**Identification.** The client puts a path param in the URL: `n=<id>` for "new" or
`o=<id>` for "open existing" (`shiny-server-client/lib/decorators/reconnect.js:212`),
parsed by `pathParams.extractParams` (`:29`). No `n`/`o`, or `id === 'none'`, means
"not robust" and `robustify` returns the raw connection unchanged (`:60-69`).

**Dispatch table** (`robustify`, `:58-116`) — four cases, all exercised by
`test/robust-sockjs.js:27-57`:

| | id in table | id not in table |
|---|---|---|
| `o=` (existing) | `set(conn, true)` → resume, return **falsy** | close `BAD_IDENTIFIER` |
| `n=` (new) | if nascent: `set(conn, false)`, return falsy; else close `BAD_IDENTIFIER` (collision) | create `RobustConn`, return it |

Returning falsy is the signal to `sockjs.js` "already wired up, do nothing more".

**Nascent vs. mature** (`:126-134`). A `RobustConn` is *nascent* until it receives its
first `data` event (`:274-276`). A nascent conn may be re-`set` with `resume=false`.
This exists for a specific real-world failure: proxies like nginx with
`proxy_http_version 1.0` silently truncate `xhr-streaming`, so the server thinks the
connection succeeded while the client thinks it never started and retries with a fresh
`n=<same id>`. Rather than a collision error, we pretend the first connection never
happened and resend the whole buffer from 0 (`:228-253`). The `assert` at `:232` is a
hard invariant: `set(conn, false)` on a mature conn is a programming error.

**Wire protocol** (implemented in `shiny-server-client/common/message-{buffer,receiver,utils}.js`):

- Outbound messages are tagged `"<HEX-ID>#<payload>"`, ids monotonic per direction,
  assigned in `MessageBuffer.write` and kept in the buffer until ACKed.
- `"ACK <HEX-ID>"` — id is the first id *not* seen, so `ACK 0` means "nothing". May
  arrive at any time, including while awaiting CONTINUE (`:309-318`). Discards from
  the buffer.
- `"CONTINUE <HEX-ID>"` — sent by both sides immediately after reconnection, symmetric
  and not a request/response pair (`:222-227`). Receiving it discards the ACKed
  prefix and replays everything from that id (`:320-337`).
- The server auto-ACKs on a 2-second idle timer
  (`MessageReceiver`'s default `_ackTimeout`, wired at `robust-sockjs.js:138-143`).
- Anything unexpected where CONTINUE was required → close with `BAD_PROTOCOL`
  (`:322-323`, `:344-348`).

**Withholding close/end** (`:351-366`). When the underlying conn emits `end` or
`close`, `RobustConn` swallows it and starts a single timer (default **15 seconds**,
`:43-47`; `sockjs.js:48` constructs the registry with no argument, so 15s is what
production uses). If a new conn arrives first, `set()` clears the withheld events and
the timer (`:211-216`). If the timer fires, the withheld events are replayed, the id
is deleted from the registry, and `_readyState` flips to 3. Note `readyState` is a
getter over `_readyState` (`:168-176`) so callers see a *stable* "open" state across
transport churn — deliberately lying about the truth.

**How the swap works** (`:264-370`). `conn.emit` is monkey-patched so events fire on
both the `RobustConn` and the original conn (`_oldEmit`). On retire, the original
`emit` is restored (`:204`) and the stale conn is closed with `RETIRED` (`:209`) —
which a client should essentially never see, since it means two live transports for
one robust id.

**Leak risks:**

- `MessageBuffer` is unbounded. A client that connects, receives a lot, and never ACKs
  (or reconnects) holds all of it in memory for the life of the RobustConn.
- `self._connections[id]` is only deleted by the withhold timer (`:363`). To be clear,
  **holding the entry for the full withhold window is the design, not a leak** — that
  window *is* the resumption grace period (see the constructor comment at `:41-42`),
  and a reconnect inside it clears the timer at `:212-216` precisely so the entry
  survives. The fragility is that this is the *only* deletion path: any future change
  that discards a `RobustConn` without letting that timer fire strands a registry entry
  (and a Shiny session, since `sock` is released only via the withheld `close`).
- `_withheld.timer` is never reset to null after firing, so the guard at `:354` would
  block a second timer — harmless only because the entry is gone by then.

## multiplex (`lib/proxy/multiplex.js`)

**Why:** Shiny apps can embed sub-apps in iframes. Each needs its own Shiny session,
but browsers cap concurrent connections per host, and each SockJS connection would be
a separate robust session. So `shiny-server-client`
(`lib/multiplex-client.js`, `lib/decorators/multiplex.js`) runs N logical channels
over one physical SockJS connection, and the parent frame's multiplexer is what the
iframes call into (`shiny-server-client/lib/subapp.js`).

**Wire format** (`multiplex.js:29-38`): `channelId|method|data`, parsed by the regex
at `:158`. Ids are decimal, unique only within one `MultiplexSocket`.

- `o` — open channel; data is the request URL, **relative** to the physical
  connection's URL. Relative on purpose (`:71-74`): an intermediary proxy may rewrite
  HTTP URLs but can't see inside the WebSocket payload, so absolute URLs would break.
  Empty payload means "use the physical connection's URL" (that's the primary
  channel). Otherwise the server strips `/__sockjs__/…` from the parent URL and
  `path.join`s (`:79-83`).
- `m` — channel message.
- `c` — close; data is `JSON.stringify({code, reason})`.

Note the framing composes *inside* the robust framing: the final bytes on the wire are
`"<hexId>#<chanId>|m|<payload>"`, because `MultiplexChannel.write` formats first
(`:128`) and hands the result to `RobustConn.write`, which prepends the message id.

`MultiplexChannel` (`:115-145`) is a duck-typed SockJS connection: it copies a fixed
list of properties from the real conn (`connectionProps`, `:192-194`) but overrides
`url`. The routers and `connectToApp` can't tell the difference. `_destroy()` sets
`readyState = 3` and emits `close` without sending anything on the wire — used when
the physical connection died (`:47-54`).

**Gotchas:**

- `MultiplexChannel` asserts `readyState === 1` at construction (`:121`). Over a
  `RobustConn` this is satisfied by the lying `readyState` getter.
- A channel cannot outlive or predate its physical connection (`:22-23`), and the
  client's `MultiplexClient` cannot go from zero channels back to one — so don't
  expect to reuse a drained connection.
- On receiving `c` from the *server*, the client closes the **entire physical
  connection**, not just the channel (`shiny-server-client/lib/multiplex-client.js:72-75`).
  So a per-channel close initiated server-side takes down all sibling sub-app
  sessions.
- An unparseable packet kills the whole physical connection (`:58-62`).
- The `else` branch for a non-`o` method on an unknown channel is an empty
  `// TODO: ...what?` (`:93-95`) — messages for dead channels are silently dropped.
- Nothing server-side reads the `s`, `t`, or `w` path params the client adds; only
  `n`/`o` are consumed (by robust-sockjs).

## errorcode.js — what the browser is told

`lib/proxy/errorcode.js` encodes a 2-bit policy into the WebSocket close code so
`shiny-server-client` and Shiny ≥ 0.13 know whether to reconnect, restart, or give up.
The scheme is documented in the header comment (`:21-41`):

- `45xx` — clean; don't reconnect, don't restart.
- `46xx` — disruption; reconnect and/or restart. (Never emitted explicitly; unclean
  closes with `!wasClean` play this role.)
- `47xx` — bad session; don't reconnect, but a fresh session is fine.

Actual values (verified by evaluating the module):

| Constant | Code | Raised at |
|---|---|---|
| `ACCESS_DENIED` | 4500 | `sockjs.js:87` — robust conn to a `reconnect false` app |
| `OUT_OF_CAPACITY` | 4501 | `sockjs.js:133` — `OutOfCapacityError` on a WS |
| `SHUTTING_DOWN` | 4702 | `sockjs.js:228` — worker died during server shutdown |
| `APP_EXIT` | 4503 | `sockjs.js:230` — worker died unexpectedly |
| `BAD_PROTOCOL` | 4704 | `robust-sockjs.js:346` — robust framing violation |
| `BAD_IDENTIFIER` | 4705 | `robust-sockjs.js:96, 106` — collision or unknown id |
| `RETIRED` | 4506 | `robust-sockjs.js:209` — old conn superseded |

The base numbers must stay unique and stable across releases — see the comment at
`errorcode.js:45-49`. Don't renumber.

HTTP-side error surfaces (all rendered from Handlebars templates in `assets/`, with a
per-server/app `template_dir` override):

- **404** — no route, or `err.code === 'ENOTFOUND'` from the scheduler
  (`http.js:113, 125, 213`).
- **503 "Too Many Users"** — `OutOfCapacityError` (`http.js:149`,
  `render.js:133-141`).
- **500** — `error500` (`http.js:30-57`) for "The application failed to start"
  (worker never came up; `err.consoleLogFile` is set by
  `lib/scheduler/scheduler.js:145`), "The application exited unexpectedly" (upstream
  error mid-proxy), "An error occurred while transferring data…" (client-side `req`
  error), and "Invalid application configuration". Each tails 8KB of the worker log
  and embeds it in the page **unless `sanitizeErrors` is set** (`http.js:42`).

## Timeouts, all in one place

| What | Value | Where |
|---|---|---|
| Server socket idle timeout | 45s, config `http_keepalive_timeout` | `lib/server-init.js`, `config-router.js:116-119` |
| SockJS heartbeat | 25s, config `sockjs_heartbeat_delay` | `sockjs.js:44`, `config-router.js:121-124` |
| SockJS disconnect delay | 5s, config `sockjs_disconnect_delay` | `sockjs.js:45`, `config-router.js:126-129` |
| Robust reconnect window | 15s, **hardcoded** | `robust-sockjs.js:43-47` (registry built with no arg at `sockjs.js:48`) |
| Robust auto-ACK | 2s, **hardcoded** | `MessageReceiver` default |
| Pending-session reservation | 45s, **hardcoded** | `http.js:171` |
| Worker idle reap | 5s, config `app_idle_timeout` | `scheduler.js:127-137` |

The socket timeout deserves a read of the comment at `lib/server-init.js`: Node's
`socket.setTimeout` starts counting from the last `write()` *call*, not completion, so
it can fire during genuinely active transfers. It's set deliberately longer than the
SockJS heartbeat so that polling transports aren't culled.

## Cross-cutting invariants

- **Every `acquire()` must be matched by exactly one `release()`.** Both call sites say
  so in caps (`sockjs.js:150`). The `_.once` wrappers are what make the
  `finish`+`close` and multi-listener patterns safe.
- **`getWorker()` is synchronous and throws**; `getAppWorkerHandle_p()` is the async
  part. Conflating them is the bug the TODO comments at `http.js:138-140` and
  `sockjs.js:122-124` are warning about.
- **`AppWorkerHandle.proxy` is created lazily and closed exactly once**, from
  `exitPromise` (`http.js:187-192`). If a worker handle is ever created without a
  resolving/rejecting `exitPromise`, that proxy leaks.
- **Routers must return a `prefix` that is a real prefix of `req.url`**; violations are
  logged as `logger.error` and 404'd (`http.js:123-127`).
- The unix-socket transport is **not wired up** — `lib/server-init.js` always constructs
  a `TcpTransport`. `lib/transport/unix-socket.js:99` references `this.$port`, which
  that class never sets, so `createWebSocketClient` would build a malformed URL. Treat
  that file as untested.
