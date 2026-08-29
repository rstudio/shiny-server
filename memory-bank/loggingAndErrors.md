---
title: Logging And Errors
description: How Shiny Server logs (log4js server log to stdout, morgan access log, per-app log files), how errors turn into HTTP responses and SockJS close codes (error500/error404/errorAppOverloaded, errorcode.js), how sanitize_errors gates leaking R stderr to browsers, and how the Handlebars template cascade in lib/core/render.js resolves templates/error.html, directoryIndex.html, and custom template_dir overrides. Read before touching logging config directives (log_dir, log_file_mode, log_as_user, preserve_logs, access_log, template_dir, sanitize_errors), log rotation/ownership, or any user-facing error page.
---

# Logging And Errors

There are **three distinct log streams** in Shiny Server, and they have almost
nothing to do with each other:

1. **The server log** — log4js, written to the process's stdout
   (`lib/core/log.js`). Everything the Node process itself has to say.
2. **The access log** — morgan, written to a file named by the `access_log`
   config directive (`lib/server-init.js`).
3. **Per-app worker logs** — one file per worker process, capturing the R/Python
   child's stderr. Covered in depth in `memory-bank/appWorkers.md`; only the
   parts that couple to this doc (naming, ownership, deletion, and being tailed
   into error pages) are described here.

---

## The server log (log4js)

`lib/core/log.js` is deliberately tiny and is required *first* in
`lib/main.js`, before anything else, because it installs `global.logger` —
an implicit global that essentially every module in the codebase uses without
importing it. `test/.mocharc.json` also requires it for the same reason.

- **One appender only**: `stdout` (`lib/core/log.js:18-21`). There is **no file
  appender**. The familiar `/var/log/shiny-server.log` is produced by the
  service definition redirecting stdout+stderr:
  `config/systemd/shiny-server.service:6` and
  `config/upstart/shiny-server.conf:22` both do `>> /var/log/shiny-server.log 2>&1`.
  Consequence: the server log path is **not** configurable from
  `shiny-server.conf`, and Shiny Server never opens, rotates, or reopens that
  file itself.
- **Layout is TTY-sensitive** (`lib/core/log.js:17`): `colored` when stdout is a
  tty, `basic` otherwise. This is why running under systemd yields plain text
  and running interactively yields ANSI color.
- **Level** comes solely from the `SHINY_LOG_LEVEL` environment variable,
  defaulting to `INFO` (`lib/core/log.js:29`). log4js levels apply, so `TRACE`
  is the useful one for proxy/scheduler debugging — a great deal of the
  interesting narrative (`logger.trace`) is invisible at the default level.
- **There is no runtime level change.** `SIGHUP` reloads the config and flushes
  the template cache (`lib/main.js`) but does not touch the log level;
  no config directive sets it. Changing the level requires restarting the
  process with a different `SHINY_LOG_LEVEL`.
- `lib/core/log.js:26-28` monkey-patches `setLevel` back onto the logger
  prototype as a shim for the pre-6.x log4js API. Nothing in the repo currently
  calls `setLevel` except log.js itself; the shim exists for compatibility and
  can be removed only after confirming no external/patch consumers.
- **There is no `--log-dir` CLI flag.** The only flags `lib/main.js` reads via
  optimist are `--version`, `--pidfile`, `--memlog`, and a positional config
  file path (`lib/main.js`).

### Logging before the config is loaded

Because log.js is required at module load, `logger` is usable immediately: the
version banner, pidfile message, and config path are all logged before the
config file is even read (`lib/main.js`, `:84`, `:107`). Config-parse
failures are therefore reported on the server log with a distinct message for
`ENOENT` (`lib/server-init.js`), and a startup failure exits with code 1
(`lib/server-init.js`).

Two consequences of the "config loads asynchronously after the server is
already listening" design:

- `requestLogger` is `null` until `createLogger_p` resolves, so requests served
  during the startup window are silently absent from the access log
  (`lib/server-init.js`, `:267-271`).
- `lib/server-init.js` — the `upgrade` handler's pre-config branch references
  an undefined `res` variable. A WebSocket upgrade arriving before the config
  parses will throw `ReferenceError` instead of logging cleanly. This is a
  latent bug, not intended behavior.

### Log rotation for the server log

`config/logrotate` targets `/var/log/shiny-server.log` with `copytruncate`
(rotate 12, compress, size 1M). `copytruncate` is *required* here, not
incidental: the process holds an inherited stdout fd from the service manager
and has no mechanism to reopen it on `SIGHUP`, so a rename-based rotation would
leave the server writing into a deleted inode forever.

---

## Access logging (morgan)

- Configured by the `access_log` directive (`config/shiny-server-rules.config:23`),
  which takes a path plus an optional format. It is a top-level (`at $`)
  directive only — there is no per-server or per-location access log.
- Parsed into a plain `{path, format}` spec by `createAccessLogSpec`
  (`lib/router/config-router.js:249-256`), stored as
  `configRouter.accessLogSpec` (`lib/router/config-router.js:105`).
- `createLogger_p` (`lib/server-init.js`) opens the path with `flags: 'a'` and
  wraps morgan around it. The legacy Connect format name `"default"` is
  rewritten to morgan's `"combined"` (`lib/server-init.js`) — the schema's
  default value is still the string `default`, so this translation is what keeps
  old config files working.
- **Dead code**: `lib/server-init.js` is unreachable (it follows an
  unconditional `return`), a leftover from the pre-morgan implementation that
  used to `fs.open` with mode `0660`. The access log gets no explicit mode; it
  is created with the process umask.
- **Wiring is deliberately outside Express.** morgan is attached as a *second*
  `server.on('request', ...)` listener (`lib/server-init.js`), registered after
  the Express handler (`lib/server-init.js`), and is invoked with a no-op `next`.
  It is not middleware in the proxy chain. This matters because most Shiny
  traffic is proxied by `ShinyProxy` or hijacked by SockJS before Express
  middleware would finish; making morgan a listener guarantees it sees every
  request and can never interfere with routing. morgan records on response
  finish, so the ordering relative to Express is harmless.
- **The access log is not rotated by anything shipped in this repo** —
  `config/logrotate` covers only `/var/log/shiny-server.log`. Admins enabling
  `access_log` must supply their own rotation, and because the stream is opened
  once at config-load time, they should use `copytruncate` or send `SIGHUP`
  (which re-runs `loadConfig_p` and hence reopens the stream).

---

## The error "taxonomy"

`lib/core/errors.js` is much smaller than its name suggests: an `AbstractError`
base plus exactly **one** exported class, `OutOfCapacity`
(`lib/core/errors.js:14-21`), signalling that a scheduler refused to hand out a
worker because the app's concurrency limit is exhausted. Everything else is
signalled by convention, not by class:

- `err.code === 'ENOENT'` — treated as "app not found" → 404
  (`lib/proxy/http.js:212-213`).
- `err.code === 'ETIMEOUT'` — was produced by `qutil.withTimeout_p`, which has
  been removed. Nothing produces or checks it any more; an app that fails to
  come up within `app_init_timeout` rejects from `connectEndpoint_p`
  (`lib/scheduler/scheduler.js`) with the plain message "The application took
  too long to respond." instead.
- `err.consoleLogFile` — an ad-hoc property attached by worker-launch failures so
  the 500 page can tail the right log file (`lib/proxy/http.js:216`).

So: when adding a new failure mode, follow the existing grain (a `code` property
or a duck-typed field) rather than expecting a rich hierarchy.

`OutOfCapacity` is caught synchronously and specially, outside the promise
chain, in `lib/proxy/http.js:141-153` — with an explicit comment explaining why:
throwing it from inside the chain crashed as an unhandled exception rather than
reaching `.fail()`.

---

## From error to HTTP response

The single funnel is `lib/core/render.js#sendPage` (`lib/core/render.js:23-89`).
Three convenience wrappers sit on top:

| Helper | Status | Template | Where |
|---|---|---|---|
| `error404` | 404 | `error-404` | `lib/core/render.js:121` |
| `errorAppOverloaded` | 503 | `error-503-users` | `lib/core/render.js:133` |
| `error500` | 500 | `error-500` | `lib/proxy/http.js:30-57` (local, not in render.js) |

`error500` lives in the proxy rather than render.js because it does something
the others don't: it tails the worker's log file. Call sites in
`lib/proxy/http.js`:

- `:113` / `:125` — no AppSpec matched, or a router returned a prefix that
  doesn't match the URL (that one also logs at `error` — it indicates a router
  bug).
- `:149` — out of capacity.
- `:197-201` — error on the client→proxy request mid-stream.
- `:210-218` — failed to get a worker: `ENOTFOUND` → 404, otherwise 500 "The
  application failed to start."
- `:221-226` — anything the router chain rejected → 500 "Invalid application
  configuration."
- `:261-266` — `http-proxy` `error` event (upstream dropped) → 500 "The
  application exited unexpectedly."

`error500` is careful about ordering: it tails, renders, and then `res.end()`s
in a `.fin()` guarded by try/catch (`lib/proxy/http.js:49-55`), because by the
time these fire the response may already be half-written or the socket gone.

### Sanitization

`sanitize_errors` defaults to **true** (`lib/router/config-router-util.js:59`;
directive at `config/shiny-server-rules.config:255`), and is only turned off by
an explicit `false` (`lib/router/config-router-util.js:97-100`). It has two
independent effects:

1. **Server-side gating of stderr leakage.** `lib/proxy/http.js:42` passes the
   tailed console log into the template *only* when sanitization is off; the
   SockJS path does the same at `lib/proxy/sockjs.js:199-219`, substituting
   "Diagnostic information is private. Please ask your system admin…" for the
   actual log dump.
2. **In-app error masking.** The flag is forwarded to the R worker
   (`lib/worker/app-worker.ts:578`) and becomes
   `options(shiny.sanitize.errors = ...)` in `R/SockJSAdapter.R:48`, so Shiny
   itself replaces error text with a generic message unless wrapped in
   `safeError()`.

The *why*: worker log files routinely contain connection strings, file paths,
and stack traces from arbitrary user R code. The default assumes untrusted end
users; turning it off is an explicit "this deployment is internal" decision.
It's a per-location setting, so one server can be verbose for an internal app
and sanitized for a public one.

The log tail is capped at 8192 bytes (`lib/proxy/http.js:31`,
`lib/proxy/sockjs.js:199`) via `fsutil.safeTail_p`, which reads from the *end*
of the file, drops a partial first line, and skips UTF-8 continuation bytes
(`lib/core/fsutil.js:69-102`).

### SockJS/WebSocket close codes

Browser-side failures that happen after a session is established can't render an
HTML page, so they're communicated as close codes plus injected client messages.
`lib/proxy/errorcode.js` documents the scheme: the *hundreds digit* encodes
reconnect/restart policy for shiny-server-client — `45xx` no reconnect no
restart, `46xx` reconnect + restart, `47xx` restart only
(`lib/proxy/errorcode.js:21-42`). The comment at `:45-49` is a hard constraint:
**base numbers must be unique and stable across releases**; never renumber. The
alert/console text is delivered via
`render.sendClientConsoleMessage` / `sendClientAlertMessage`
(`lib/core/render.js:96-117`), which write a `{custom: {console|alert}}` JSON
envelope the client understands.

---

## Template rendering (`lib/core/render.js`)

Handlebars, compiled per call, with a module-level cache of *template source*
(not compiled functions) at `lib/core/render.js:20`.

**The cascade** (`lib/core/render.js:41-75`) is the interesting part. A template
name is split on `-`, and progressively shorter prefixes are tried:
`error-503-users` → `error-503` → `error`. Each level is looked for in the
admin's `template_dir` (`config/shiny-server-rules.config:199`) and in the
shipped `templates/` directory (`paths.projectFile`, `lib/core/paths.js:19`).
Candidates are ordered so that **any** custom template beats **every** built-in
one — `providedTemplates.concat(customTemplates)` then popping from the end
(`lib/core/render.js:67-75`). So a site-wide custom `error.html` overrides the
built-in `error-404.html`. `test/render.js:95-112` pins exactly this precedence;
change it and that test fails.

Other invariants worth knowing:

- If nothing resolves, `sendPage` **throws** (`lib/core/render.js:78`). Callers
  such as `directory-router.js:72` do not catch it. Deleting `templates/error.html`
  turns every error into a crash-adjacent failure.
- The cache key is naive string concatenation of `templateDir + template`
  (`lib/core/render.js:37`, `:82`). It is theoretically ambiguous
  (`"/a/b"+"c"` vs `"/a/"+"bc"`) and stringifies `undefined` for the no-custom-dir
  case. Harmless in practice, but don't rely on the key for anything.
- The cache is flushed only on `SIGHUP` (`lib/main.js`) and in tests
  (`render.flushCache`, `lib/core/render.js:143-146`). Editing a custom template
  requires a `SIGHUP`.
- `templateDir` reaches error paths two ways: attached to the request at the
  server level (`req.templateDir`, `lib/router/config-router.js:337-339`, so
  pages can be rendered without an AppSpec) and via
  `appSpec.settings.templateDir` for per-location overrides
  (`lib/router/config-router.js:503-504`).

### The shipped templates

- `templates/error.html` — the base of the cascade. Variables: `title`,
  `message`, `detail`, `detailHTML`, `console`. **`detailHTML` is the only
  triple-stash (unescaped) slot** (`templates/error.html:40-42`); no code in the
  repo ever populates it, so it exists purely as an extension point for custom
  templates. Anyone who starts passing `detailHTML` is opting into an XSS
  surface. `console` is escaped, which is why raw R stderr is safe to embed.
- `templates/directoryIndex.html` — rendered by the directory-index surface.
  It iterates `apps`, `dirs`, `files`, but **`apps` is never populated** by any
  caller; `lib/router/directory-router.js:255-262` passes only `files` and
  `dirs`. Vestigial.
- `templates/config.html` — **not a runtime template.** It is consumed at build
  time by `tools/makedocs.js:129-131` to generate the admin-guide directive
  reference from `config/shiny-server-rules.config`. It never passes through
  `render.js`.

### The directory-index surface

`lib/router/directory-router.js` is where static-file serving, autoindex, and
app detection all meet.

- Autoindex is opt-in (`this.$dirIndex`) and only kicks in when a directory has
  no `index.html` (`:169-192`). It rejects dotfiles and anything matching the
  router's blacklist (`:214-223`) — `UserDirsRouter` uses that blacklist to hide
  `~/ShinyApps/log` (`lib/router/user-dirs-router.js:77-81`), which is the
  mechanism preventing users' app logs from being served over HTTP. Hidden path
  elements and `..` are separately rejected with a 403 (`:70-77`).
- Two `.fail` handlers here **swallow errors into "not found"**: `:85-88` logs
  at `error` and returns `null`, and `:394-397` logs at `debug` and returns
  `{res: null}`. A permissions problem on an app directory therefore surfaces to
  the user as a plain 404 with the real cause visible only in the server log —
  and at DEBUG level for the second one.

---

## Per-app log files (pointers)

Full detail in `memory-bank/appWorkers.md`. The contract that other subsystems
depend on:

- **Path/name**: `Scheduler#getLogFilePath` (`lib/scheduler/scheduler.js:281-290`)
  builds `<appDirBasename>-<runAs>-<YYYYMMDD-HHmmss>-<endpointSuffix>.log` under
  `appSpec.logDir`. If no `log_dir` is configured it returns **`/dev/null`**
  (`:282-283`) — so a missing `log_dir` silently discards all app stderr rather
  than erroring. `user_apps` always uses `~/ShinyApps/log` regardless of
  `log_dir` (see the directive text at `config/shiny-server-rules.config:109`).
- **Ownership/permissions**: `log_file_mode` (default `0640`,
  `lib/router/config-router-util.js:79-87`) is applied by explicit `chmod` after
  open, specifically so the process umask can't reduce it
  (`lib/worker/app-worker.ts:217-233`). `log_as_user` switches creation to a
  setuid'd `scripts/create-log.sh` child (`lib/worker/app-worker.ts:166-191`),
  which exists for NFS `root_squash` home directories where root cannot create
  files.
- **Deletion**: on a clean, idle-timeout-triggered exit the log is deleted
  (`lib/scheduler/scheduler.js:194-223`; `deleteLogFileOnExit` is set true only
  in the idle-timeout handler, `:234`). `preserve_logs` disables this
  (`lib/router/config-router-util.js:74-77`). The directive's own warning is
  real: with `preserve_logs true` and no rotation, log files accumulate without
  bound.
- **Nothing rotates per-app logs.** No shipped logrotate config covers
  `log_dir`.
- `SHINY_LOG_STDERR` (any non-empty value) additionally mirrors worker stderr to
  the main process's stderr, i.e. into the server log
  (`lib/worker/app-worker.ts:41`). It is env-only, not a config directive.

---

## Gotchas summary

- **`.eat()` swallows rejections.** `Q.makePromise.prototype.eat`
  (`lib/core/qutil.js:20-22`) discards the error entirely with an empty handler.
  It appears throughout `main.js`, `scheduler.js`, and `http.js`. When a failure
  seems to vanish without a log line, look for `.eat()`.
- **`safeTail_p` never rejects** — it resolves `''` on any error and logs
  non-ENOENT failures itself (`lib/core/fsutil.js:110-121`). The
  `.fail(function(consoleLog) { return; })` at `lib/proxy/http.js:32-34` (and
  its twin at `lib/proxy/sockjs.js:200-202`) is therefore dead code, and
  misleadingly named — its parameter is an error, not a log.
- **`uncaughtException` is re-thrown** after logging (`lib/main.js`), via
  a synthetic `uncaughtException2` event used to run cleanup first. The process
  really does die.
- **`clientError` is logged at DEBUG** (`lib/server-init.js`) because
  ECONNRESET/EPIPE are constant background noise; genuine client-side problems
  are invisible at the default INFO level.
- **Unknown proxy events are logged as warnings** (`lib/proxy/http.js:240-248`)
  against the `knownEvents` allowlist (`:61-67`) — a tripwire for
  `http-proxy` changing its event surface across upgrades. New warnings after
  a dependency bump mean that list needs updating, not that something broke.
- Writes to a worker's log stream that fail are warned about **at most once per
  worker** (`lib/worker/app-worker.ts:241-247`).
