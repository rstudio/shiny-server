---
title: Transport Layer (Worker Sockets)
description: How shiny-server connects to spawned R/Python worker processes at the socket level — the Transport/Endpoint interface contract in lib/transport/, TCP loopback ports vs. Unix domain sockets, port/socket-path allocation, the per-worker shiny-shared-secret handshake, the socket_dir config directive, and how R/SockJSAdapter.R and python/SockJSAdapter.py learn where to listen. Read this when touching worker connectivity, proxy targets, log-file naming, or debugging "failed to connect to worker" problems.
---

# Transport Layer (Worker Sockets)

Every Shiny app runs in its own OS process (see `lib/worker/app-worker.ts`). The
server talks to that process over an ordinary local HTTP/WebSocket connection.
The **transport layer** (`lib/transport/`) is the thin abstraction that decides
*what kind of socket* that is, allocates a unique address for each worker, and
hands the same address to both sides (the proxy and the R/Python process).

## The two-level shape: Transport → Endpoint

There are exactly two objects.

**`Transport`** is a long-lived singleton, created once in `lib/main.js:136` and
pushed down to every scheduler via `SchedulerRegistry.setTransport()`
(`lib/main.js:255`, `lib/scheduler/scheduler-registry.js:48-53`). It has two
methods:

- `setSocketDir(path)` — called on every config (re)load from
  `lib/main.js:256`. TCP ignores it (`lib/transport/tcp.js:27-29`).
- `alloc_p()` — returns a promise of a fresh `Endpoint`. Called once per worker
  launch at `lib/scheduler/scheduler.js:164`.

**`Endpoint`** is per-worker and carries the address plus a per-worker secret.
Its contract (hand-declared in `lib/transport/tcp.d.ts:3-15`):

| Member | Purpose | Consumed at |
|---|---|---|
| `getSharedSecret()` | 16 random bytes, hex | `lib/proxy/http.js:204` |
| `connect_p()` | resolves `true`/`false` — is anything listening yet? | `lib/scheduler/scheduler.js:90` (startup poll loop) |
| `getHttpProxyTarget()` | `target` option for http-proxy | `lib/proxy/http.js:237` |
| `createWebSocketClient(path, headers)` | faye-websocket client aimed at the worker | `lib/proxy/sockjs.js:167` |
| `getAppWorkerPort()` | string handed to the worker as its listen address | `lib/worker/app-worker.ts:568` |
| `getLogFileSuffix()` | disambiguates worker log filenames | `lib/scheduler/scheduler.js:287` |
| `toString()` / `ToString()` | log messages; differ only in capitalization | throughout |
| `free()` | release the address | `lib/scheduler/scheduler.js:190` (worker-exit `fin`) |

`free()` is a no-op in **both** implementations
(`lib/transport/tcp.js:165`, `lib/transport/unix-socket.js:126`). The comment at
`lib/transport/tcp.js:36-39` explains why it exists anyway: keeping the
alloc/free discipline preserves the option of switching to a preallocated
address pool later.

`BaseEndpoint` (`lib/transport/shared.js:18-23`) is the only shared code: it
generates the shared secret. Both `Endpoint` classes `util.inherits` from it.

## The shared secret is the actual access control

The comment at `lib/transport/shared.js:19-21` states the purpose plainly: make
the app respond only to the process that spawned it. This matters because a
worker is, at the OS level, a normal local HTTP server — anything that can reach
the socket can speak to the app.

- Server side: the header is injected on every proxied HTTP request
  (`lib/proxy/http.js:204`) and baked into the WebSocket client's headers by the
  transport itself (`lib/transport/tcp.js:127`,
  `lib/transport/unix-socket.js:103`) — note `lib/proxy/sockjs.js:167` passes no
  headers, so the transport default is what protects the WebSocket path.
- R side: `options(shiny.sharedSecret = ...)` at `R/SockJSAdapter.R:105`, from
  the `SHINY_SHARED_SECRET` env var set at `R/SockJSAdapter.R:26`. httpuv/shiny
  enforces it.
- Python side: `SharedSecretMiddleware` (`python/SockJSAdapter.py:50-80`) wraps
  the ASGI app (`python/SockJSAdapter.py:185`) and returns a 403 for any HTTP or
  WebSocket scope missing the correct `shiny-shared-secret` header. Non-HTTP
  scopes (e.g. `lifespan`) are passed through.

The secret is fresh per `Endpoint`, i.e. per worker process, not per server.

## TCP transport (the default, and the only one wired up)

`lib/main.js:136` hardcodes `new TcpTransport()`. `UnixSocketTransport` is
imported at `lib/main.js:43` but **never instantiated** — the Unix-socket
implementation is live code that nothing currently selects. There is no config
directive that switches transports.

The history is worth knowing: commit `e9d1c7d` ("Go back to using TCP sockets
for communication", Aug 2013) is what created this abstraction. Unix domain
sockets came *first*; a load test (`manual.test/loadtest.js`) showed TCP was "far
more stable", so TCP won and the transport interface was extracted specifically
so the two could be swapped again cheaply. The instability was never root-caused
in the commit message.

**Allocation** (`lib/transport/tcp.js:41-83`) does not maintain a pool. It asks
the OS for an ephemeral port by `server.listen(0, '127.0.0.1')`
(`lib/transport/tcp.js:72`), reads `server.address().port`, immediately closes
the listener, and hands the bare number to the worker. On `EADDRINUSE` it
retries, giving up after 5 tries (`lib/transport/tcp.js:57-64`).

> **Gotcha / known race:** uniqueness is only as good as the gap between
> "close the probe listener" and "the worker actually binds". Another process
> on the box can win that race; the retry logic only covers failures *during*
> allocation, not after. The startup poll (`connect_p` in
> `lib/scheduler/scheduler.js:90`) will happily report success against a
> squatter — the shared secret is what stops that from being exploitable.

**Reachability:** the port is bound to `127.0.0.1` only, so it's not reachable
off-box. But it *is* reachable by every local user on the machine. That is the
central security tradeoff versus Unix sockets, and the reason the shared secret
is not optional.

`createWebSocketClient` (`lib/transport/tcp.js:123-146`) also sets
`maxLength: 0x1fffffe8` — the largest frame the server will accept *from the R
process*. The comment at `lib/transport/tcp.js:132-142` explains: this is the
ceiling before Node's max string length crashes the process, and the risk of
allowing it is accepted because the only party who could abuse it is the app
author. The **client→server** direction is unchanged (~64MB default) and would
have to be raised via `faye_server_options: { maxLength }` on the
`sockjs.createServer()` call in `lib/proxy/sockjs.js`.

Log-file suffix is just the port number (`lib/transport/tcp.js:152-154`), which
is why worker logs are named `<app>-<user>-<timestamp>-<port>.log`
(`lib/scheduler/scheduler.js:281-289`).

## Unix socket transport (present, unused)

`lib/transport/unix-socket.js` allocates by generating 16 random bytes and using
the hex as a filename, `<socketDir>/<hex>.sock`
(`lib/transport/unix-socket.js:51-58`, `:65`). Uniqueness is probabilistic
(128 bits) rather than checked. The log-file suffix and `toString()` use only
the first 12 hex chars (`lib/transport/unix-socket.js:66`, `:113-119`), so the
full path never lands in log filenames.

**Socket directory** (`lib/transport/unix-socket.js:32-46`): defaults to
`/var/shiny-server/sockets`, created if absent with mode `0733` (a `chmodSync`
follows the `mkdirSync` because the mode argument "doesn't have the desired
effect" — likely umask). `0733` = owner rwx, group/other **wx but not r**:
anyone can create and traverse to a socket they already know the name of, but
nobody can *list* the directory to discover names. Combined with the 128-bit
random name, that's the unguessability story.

**Permissions on the socket itself** are set by the R side, not by Node:
`R/SockJSAdapter.R:264` attaches `attr(port, 'mask') <- strtoi('0077', 8)`,
which httpuv applies as a umask when creating the socket, yielding an
owner-only (`0700`) socket owned by the `run_as` user. So under Unix sockets a
worker is reachable only by its own `run_as` user and root — a real
improvement over TCP's "any local user". (Unverified: exact httpuv semantics of
the `mask` attribute; the intent is clear from the value.)

**Stale socket files are never cleaned up at runtime.** `free()` is a no-op and
nothing in `lib/` unlinks `.sock` files. Cleanup only happens at package
*uninstall* time: `rm -rf /var/shiny-server/sockets` in
`packaging/debian-control/postrm.in:14-15` and
`packaging/rpm-script/postrm.sh.in:13-14`. If this transport were re-enabled,
leaked socket files would accumulate across worker exits and server restarts.

### `socket_dir` config directive

Declared in `config/shiny-server-rules.config:16-22`. Root-level (`at $`),
one `String path` param, and marked `undocumented` — consistent with the
transport being unreachable. It is read into `ConfigRouter.socketDir`
(`lib/router/config-router.js:106`) and passed to `transport.setSocketDir()` at
`lib/main.js:256` on every config load; the TCP transport discards it. The
directive's own `desc` says the directory should be root-owned with mode `0333`,
which differs from the `0733` the code actually creates.

### Known bug in the unused path

`lib/transport/unix-socket.js:99` builds the URL as
`'ws://127.0.0.1:' + this.$port + path`, but `$port` is never set on the Unix
`Endpoint` — the URL becomes `ws://127.0.0.1:undefined/...`. In practice the
`socketPath` option (`lib/transport/unix-socket.js:101`) is what faye actually
dials, so the host/port in the URL may be ignored; but this would need fixing
(or at least verifying) before the transport could be trusted again.

## How the worker learns its address

The address is **not** passed on the command line. `lib/worker/app-worker.ts:317-319`
explains why: the whole `ShinyInput` object is written to the worker's **stdin**
so that "non-root users on the system can't use `ps` to discover what apps are
available and on what ports."

`createShinyInput()` (`lib/worker/app-worker.ts:561-583`) puts
`port: endpoint.getAppWorkerPort()` and `sharedSecret: endpoint.getSharedSecret()`
into that JSON blob. Note the field is named `port` regardless of transport —
for Unix sockets it carries a filesystem path.

**R** (`R/SockJSAdapter.R:20-32`) parses the JSON from stdin and re-exports it as
env vars including `SHINY_PORT`. The polymorphism is resolved at
`R/SockJSAdapter.R:258-265`: try `as.integer()`; if it's `NA`, treat the value
as a socket path and attach the `mask` attribute. The result is passed straight
to `runApp(port = port)` or `rmarkdown::run(shiny_args = list(port = port))`
(`R/SockJSAdapter.R:269`, `:278`).

**Python** (`python/SockJSAdapter.py:235`) does
`uvicorn.run(app, host="127.0.0.1", port=int(input["port"]))` — an unconditional
`int()`. **Python Shiny apps cannot use the Unix socket transport at all**; that
line would raise `ValueError`. Any future re-enablement of Unix sockets has to
handle `shiny-python` mode (uvicorn's `uds=` parameter) or exclude it.

Both adapters print `==END==` to stdout once they're configured
(`R/SockJSAdapter.R:266`, `python/SockJSAdapter.py:199`) — the handshake
`app-worker.ts` watches for before considering startup input consumed. Actual
readiness, though, is determined by polling `endpoint.connect_p()`
(`lib/scheduler/scheduler.js:89-100`), not by `==END==`.

## TypeScript coupling to watch

`lib/worker/app-worker.ts:33` does `import { Endpoint } from "../transport/tcp"`.
Two things follow:

1. `tcp.js` exports only `Transport`, not `Endpoint`. This is a **type-only**
   import that survives only because TS erases it. Using `Endpoint` as a runtime
   value there would be `undefined`.
2. The TypeScript-visible `Endpoint` type is the *TCP* shape — e.g.
   `getHttpProxyTarget(): {host: string, port: number}`
   (`lib/transport/tcp.d.ts:8`), which does not describe the Unix endpoint's
   `{host, socketPath}`. There is no shared `Endpoint` interface.

Also note `lib/transport/tcp.d.ts:7` declares `connect_p` as a *property* of type
`Q.IPromise<boolean>` rather than a method returning one — a typing bug, harmless
today only because no `.ts` file calls it.

## Test seams

`test/scheduler.js:53-60` fakes the whole Transport with an object literal
(`alloc_p` returning a stub endpoint with `getLogFileSuffix`, `free`,
`connect_p`), injected via `Scheduler.setTransport()`. That is the intended seam
for exercising the proxy/scheduler path without real processes — see the note at
`plans/2026-08-28-Express-unit-tests.md:111-113`. `test/app-worker.js:272` uses a
*real* TCP `Transport` to allocate against a real port.
