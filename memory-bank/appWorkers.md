---
title: App Workers
description: How Shiny Server launches an app worker process (lib/worker/app-worker.ts) — the shiny/rmd/shiny-python modes, `su`-based run_as user switching, the JSON-on-stdin handshake with R/SockJSAdapter.R and python/SockJSAdapter.py, the `shiny_launch_info`/`==END==` backchannel on stdout, per-worker stderr log files (log_as_user, log_file_mode, create-log.sh), bookmark state dirs, kill/SIGINT semantics, and the TypeScript build requirement.
---

# App Workers

`lib/worker/app-worker.ts` is the module that actually turns an `AppSpec` into a
running R or Python process. Everything above it (routers, scheduler, proxy) is
bookkeeping; this is where privilege dropping, process spawning, and log capture
happen. It is one of the few TypeScript files in the tree, and
`lib/worker/app-worker.js` next to it is its **compiled output, checked into
git** — see "The TypeScript story" below.

The only public entry point is `launchWorker_p(appSpec, pw, endpoint,
logFilePath, workerId)` (`lib/worker/app-worker.ts:117`). Its sole caller is
`Scheduler.spawnWorker` (`lib/scheduler/scheduler.js:176`).

## The contract with the scheduler

The scheduler owns the surrounding lifecycle, and understanding the split
matters:

- The scheduler allocates the `Endpoint` first (`lib/scheduler/scheduler.js:164`).
  An endpoint carries the port/socket path *and* a per-worker random 16-byte
  shared secret (`lib/transport/shared.js:22`).
- The scheduler computes the log file path
  (`Scheduler.getLogFilePath`, `lib/scheduler/scheduler.js:281`), awaits
  `userDb.lookupUser_p(appSpec.runAs)`, and hands the user record in. AppWorker
  never looks up the `run_as` user itself.
- AppWorker returns a promise for an `AppWorker` object as soon as the process
  has been *spawned*. It makes no claim that the app is up. Readiness is
  determined entirely by the scheduler polling `endpoint.connect_p()` with
  backoff until `app_init_timeout` (`connectEndpoint_p`,
  `lib/scheduler/scheduler.js:56` and `:252`). The stdout handshake described
  below is *not* the readiness signal.
- `appSpec.runAs` is typed `string | ReadonlyArray<string> | undefined`
  (`lib/worker/app-spec.ts:16`) because config can supply a list of candidate
  users. `SquashRunAsRouter` (`lib/router/squash-run-as-router.js:37`) collapses
  it to a single non-`:special:` string before it reaches here.
  `createAppWorker` re-asserts this at runtime
  (`lib/worker/app-worker.ts:328`) because the type system can't.

## Preconditions and the root guard

`launchWorker_p` rejects up front if the passwd entry is missing, if the user has
no home directory, if `appDir` is unset, or if `appDir` doesn't exist
(`lib/worker/app-worker.ts:124-142`). The "app dir does not exist" error is
tagged `code = "ENOTFOUND"`, which `lib/proxy/http.js:212` translates into a 404
rather than a 500.

The security-critical invariant lives at `lib/worker/app-worker.ts:325-335`:

```
switchUser = appSpec.runAs !== null && permissions.getProcessUser() !== appSpec.runAs
if (!switchUser && permissions.isSuperuser()) throw "Aborting attempt to launch worker process as root"
```

So: **a worker is never run as root.** If Shiny Server is running as root, some
user switch must happen. If Shiny Server is *not* running as root and `run_as`
names a different user, no guard fires here — the `su` will simply fail at
runtime and the app will appear to fail to start. Running non-root only works
cleanly when `run_as` is the same user as the server process (this is exactly the
configuration `test/app-worker.js` exercises, via
`permissions.getProcessUser()` at `test/app-worker.js:238`).

## The three modes

`appSpec.settings.mode` is one of `"shiny"`, `"rmd"`, `"shiny-python"`
(`lib/worker/app-spec.ts:41`). The dispatch is at
`lib/worker/app-worker.ts:347-371`.

**`shiny` and `rmd` share an identical launch.** Both go through
`createShinySpawnSpec` (`lib/worker/app-worker.ts:583`) and run:

```
$R --no-save --slave -f <projectRoot>/R/SockJSAdapter.R
```

`$R` is `process.env.R || "R"`, resolved once at module load
(`lib/worker/app-worker.ts:37`) — so changing `R` in the environment after
startup has no effect. The mode difference is expressed only inside the adapter:
`SHINY_MODE` selects `shiny::runApp()` vs. `rmarkdown::run()` at
`R/SockJSAdapter.R:268-281`, and the adapter enforces extra minimum
rmarkdown/knitr/shiny versions in `rmd` mode (`R/SockJSAdapter.R:149-173`).

**`shiny-python`** goes through `createPyShinySpawnSpec`
(`lib/worker/app-worker.ts:609`) and runs `<python> <projectRoot>/python/SockJSAdapter.py`.
The interpreter is resolved by `python.resolvePython_p`
(`lib/core/python.ts:15`), which supports four forms of the `python` config
directive (`config/shiny-server-rules.config:206`):

- absolute path to a directory → treated as a virtualenv: exec
  `<dir>/bin/python`, prepend `<dir>/bin` to `PATH`, set `virtual_env`, and null
  out `pythonhome` (`lib/core/python.ts:24-35`)
- absolute path to a file → must be executable, used directly
- a bare name with no path separator → left as a bare `command`, deliberately
  *not* resolved, because the `run_as` user's `PATH` may differ from the
  server's (`lib/core/python.ts:50-55`)
- a relative path → resolved against `appDir`

Default is `"python3"` (`lib/worker/app-worker.ts:620`).

Note the `env` keys returned by `resolvePython_p` are lowercase (`virtual_env`,
`pythonhome`) and are `Object.assign`ed straight into the child env
(`lib/worker/app-worker.ts:623-632`). On Linux, environment variables are
case-sensitive, so these become literally `virtual_env=` and `pythonhome=`. That
is almost certainly not what was intended, but the venv still works because
`exec` points directly at `<venv>/bin/python` and `PATH` is prepended.

`PYTHONUNBUFFERED=1` is forced (`lib/worker/app-worker.ts:641`) because
`SockJSAdapter.py` dup2's stdout onto stderr; without unbuffered streams the
interleaving of lines in the log would be wrong.

## Environment handed to the app

The child env is built from scratch, not inherited — `map.compact()`
(`lib/core/map.js:28`) drops null/undefined keys:

- `HOME` = `pw.home` (from the passwd entry, not from the server's env)
- `LANG` = the server's `LANG`
- `PATH` = the server's `PATH`
- plus, for Python: `PYTHONUNBUFFERED`, and whatever `resolvePython_p` returned

That's it. **There is no user-configurable env directive in Shiny Server's config
language**, and **`R_LIBS` / `R_LIBS_USER` are never set or forwarded anywhere in
this codebase** (verified by grep). Library paths, `R_LIBS`, proxy settings, etc.
have to come from the R/Python installation's own site config or from the login
shell — which is the real reason for the `--login` flag described next.

`cwd` is `appSpec.appDir` (`lib/worker/app-worker.ts:599`), and it's set twice:
once via the spawn option and once as a literal `cd` inside the `su -c` string.

## User switching: `su`, not the C++ launcher

`wrapWithUserSwitch` (`lib/worker/app-worker.ts:654`) rewrites the spawn spec
into:

```
su -s /bin/bash --login -m -- <user> -c "cd <appDir> && <command> <args...>"     # Linux
su - -m -- <user> -c "cd <appDir> && <command> <args...>"                        # everything else
```

Every path/argument is escaped with the `bash` package's `bash.escape`. `-s
/bin/bash` is Linux-only because macOS/FreeBSD/Solaris `su` don't support it
(`lib/worker/app-worker.ts:667-673`). `--login` is what causes the user's shell
profile to be sourced, which in practice is how site admins inject `R_LIBS` and
custom `PATH` entries. `-m` asks `su` to preserve the environment that Node
passed in the `spawn` `env` option; the exact interaction between `-m` and
`--login` is `su`-implementation-specific and is not something this codebase
controls or documents.

**The C++ code in `src/` is not involved in worker launching.** Despite the name,
`src/launcher.cc` is the `shiny-server` front-end binary: it locates its own
install directory via `/proc/self/exe` (Linux) or `_NSGetExecutablePath` (macOS)
and `execv`s `ext/node/bin/shiny-server lib/main.js` (`src/launcher.cc:38-66`).
It has no setuid logic. No native module is involved in worker launching at
all: user records come from `lib/core/user-db.js` (command-backed lookups).

**`lib/worker/run-as.js` is gone.** It was a standalone script that dropped
privileges via `setgid`/`initgroups`/`setuid` and re-spawned, using the old
`SHINY_PORT`/`SHINY_APP` env-var protocol that was replaced by JSON-on-stdin.
It had no references and was deleted with the `posix` addon.

## The stdin payload and the stdout handshake

Configuration is passed on **stdin as one line of JSON**, not on argv. The
comment at `lib/worker/app-worker.ts:314-319` gives the reason: argv is
world-readable via `ps`, and app dirs/ports/shared secrets shouldn't be.

`createShinyInput` (`lib/worker/app-worker.ts:560`) builds the `ShinyInput`
object: `appDir`, `port`, `gaTrackingId`, `sharedSecret`, `shinyServerVersion`,
`workerId`, `mode`, `pandocPath` (always `<projectRoot>/ext/pandoc`),
`logFilePath`, `disableProtocols`, `reconnect`, `sanitizeErrors`,
`bookmarkStateDir`. `test/app-worker.js:341` pins the exact serialized form,
including key order, so changing field order in `createShinyInput` will break the
test.

`port` is a **string** (`Endpoint.getAppWorkerPort()`, `lib/transport/tcp.js:148`
returns `this.$port + ''`) precisely so it can also carry a Unix socket path
(`lib/transport/unix-socket.js:109`). `R/SockJSAdapter.R:261-265` handles both:
`as.integer` and, if that yields `NA`, treat it as a socket path with a `0077`
umask mask. **`SockJSAdapter.py` does `int(input["port"])`
(`python/SockJSAdapter.py:235`), so Python mode cannot use socket transport.**
This is moot today: `lib/server-init.js` unconditionally constructs a
`TcpTransport`; `UnixSocketTransport` is imported but never instantiated, and
`transport.setSocketDir(...)` is a no-op on TCP (`lib/transport/tcp.js:27`).
The `socket_dir` config directive is therefore currently inert.

The worker writes two well-known lines to **stdout**, which the server treats as
a one-shot backchannel (`lib/worker/app-worker.ts:412-426`):

1. `shiny_launch_info: {"pid":..., "versions":{...}}` — a single JSON object.
   The server parses it and stores `shinyOutput.pid` on the `AppWorker`
   (`lib/worker/app-worker.ts:417`). This is essential: when `su` is used, the
   direct child pid is `su`'s, not R's/Python's, so signals must go to the
   reported pid. Versions are only logged at trace level.
2. `==END==` — the server removes its own `data` listener and stops looking
   (`lib/worker/app-worker.ts:422-425`). The stream stays in flowing mode, so
   subsequent app stdout is discarded rather than causing backpressure
   (verified). Nothing after `==END==` is ever inspected.

R emits these at `R/SockJSAdapter.R:117-127` and `:266` — i.e. *after* all
version checks and config, immediately before `runApp`. Python emits them at
`python/SockJSAdapter.py:190-199` — *before* reading stdin and before importing
the app, so a Python worker reports its pid much earlier in its lifecycle than an
R worker does. If R fails a version check (`R/SockJSAdapter.R:129-173`) it
`stop()`s before ever printing `shiny_launch_info`, and `AppWorker.pid` stays
`null`; `kill()` then falls back to `this.$proc.pid` (`lib/worker/app-worker.ts:526`).

`sharedSecret` closes the loop: the proxy stamps every request with a
`shiny-shared-secret` header (`lib/proxy/http.js:204`), R sets
`options(shiny.sharedSecret=...)` (`R/SockJSAdapter.R:105`), and Python wraps the
ASGI app in `SharedSecretMiddleware`, returning 403 to anything without the
header (`python/SockJSAdapter.py:50-80`). Without this, any local user could hit
the worker's loopback port directly.

Both adapters also inject `sockjs.min.js`, `shiny-server-client.min.js`,
`preShinyInit({reconnect, disableProtocols})`, the Shiny Server CSS, and any
Google Analytics snippet into the `</head>` of HTML responses
(`R/SockJSAdapter.R:216-255` via `options(shiny.http.response.filter=)`;
`python/SockJSAdapter.py:83-181` via an ASGI middleware that buffers the body
until it sees `</head>` and strips `Content-Length`).

Python-specific: `SockJSAdapter.py` inserts `appDir` at the front of `sys.path`,
then decides between Shiny Express and Shiny Core by AST-inspecting `app.py` for
a `shiny.express` import or a `# shiny_mode:` magic comment
(`python/shiny_express.py:15-112`, a vendored copy of py-shiny's
`_is_express.py`). Core apps must expose a module-level `app` in `app.py`
(`python/SockJSAdapter.py:225-231`).

## Logging

Per-worker log file naming is the scheduler's job
(`lib/scheduler/scheduler.js:281-290`):

```
<logDir>/<basename(appDir)>-<runAs>-<YYYYMMDD-HHmmss>-<port-or-sockname>.log
```

If `appSpec.logDir` is falsy the path is `/dev/null`. Mode defaults to `"640"`
and is overridable with the `log_file_mode` directive, validated as an octal
string (`lib/router/config-router-util.js:79-87`).

There are two entirely different capture strategies, selected by the
`log_as_user` directive (`lib/router/config-router.js:500`):

**`log_as_user false` (default)** — `createLogFile`
(`lib/worker/app-worker.ts:193`). The *server* (running as root) creates the log
dir with mode 755, chowns it to the app user, opens the log file `"a"` with the
configured mode, chowns and chmods it, and wraps it in a WriteStream. The child's
stderr pipe is split into lines and written to that stream
(`lib/worker/app-worker.ts:427-445`); the stream is closed on stderr `end`, or in
the `catch` path if the spawn never happened (`:468`). Note `fs.mkdirSync(logDir,
"755")` is **not** recursive, so a nested `log_dir` that doesn't exist will not be
created; failures here are swallowed and only surface as a chown/open error
later.

**`log_as_user true`** — `createLogFileAsUser`
(`lib/worker/app-worker.ts:166`). The server spawns `scripts/create-log.sh
<path> <mode>` with `uid`/`gid` set to the app user; that script does
`mkdir -p`, `touch`, `chmod` (`scripts/create-log.sh:10-18`). The *path* (not a
stream) is then passed through to the worker as `logFilePath` in the JSON, and
the adapter redirects its own stderr there — R via `sink(file(LOG_FILE, "a"),
type="message")` (`R/SockJSAdapter.R:34-39`), Python via
`sys.stderr = open(path, "w")` (`python/SockJSAdapter.py:213-214`). **Python
truncates, R appends** — an inconsistency worth knowing.

Gotcha: in `log_as_user` mode the code sets `logStream = "ignore"` with the
comment "Tell the child process to drop stderr"
(`lib/worker/app-worker.ts:341`), but `spawn` still uses
`stdio: ["pipe","pipe","pipe"]` unconditionally (`:392`). The string is only a
sentinel; the server still reads the child's stderr pipe and then throws the
data away. Also, in Python's case only the Python-level `sys.stderr` object is
rebound — anything writing to fd 2 directly (a C extension, a subprocess) still
goes to the discarded pipe.

`SHINY_LOG_STDERR` (any non-empty value) makes the server *also* echo every
stderr line into its own log as `[<appDir>:<pid>] <line>`
(`lib/worker/app-worker.ts:41`, `:433`). This works in both modes.

**Log rotation applies only to the server's own log**, not to worker logs:
`config/logrotate` covers `/var/log/shiny-server.log` and is installed to
`/etc/logrotate.d` by the deb/rpm postinst scripts. Worker logs are instead
garbage-collected by the scheduler: on a clean idle-timeout exit, the log file is
deleted unless `preserve_logs` is set (`lib/scheduler/scheduler.js:193-223`).
`deleteLogFileOnExit` is only ever set to `true` in the `idletimeout` handler
(`:234`), so a *crashed* worker's log is always kept — which is what makes the
error page below useful. `/dev/null` is explicitly refused as a deletion target
(`:195`). In `log_as_user` mode the deletion is done by spawning `rm` as the app
user, since the server may not be able to unlink it otherwise.

## Bookmark state directories

Before spawning, `createBookmarkStateDirectory`
(`lib/worker/app-worker.ts:256`) creates `<bookmarkStateDir>` with mode `711` and
`<bookmarkStateDir>/<username>` with mode `700`, chowned to the user. The
per-app subdirectory (`<basename>-<md5 of appDir>`) is created lazily by R inside
the `save.interface` callback (`R/SockJSAdapter.R:55-72`). Default is
`/var/lib/shiny-server/bookmarks` (`lib/router/config-router-util.js:61`).
If the directory can't be created the whole launch rejects — `test/app-worker.js:446`
covers this, and the resulting error is an `EACCES`/`EROFS` from `mkdir`, which
is not a very self-explanatory message for an admin. Python receives
`bookmarkStateDir` in the JSON but ignores it.

## Death and cleanup

- `proc.on("exit")` resolves the `ExitStatus` deferred with `{code, signal}` and
  flips `exited` (`lib/worker/app-worker.ts:403-406`). `getExit_p()` exposes it.
- **No exit code is ever interpreted.** Nothing in `AppWorker` or `Scheduler`
  branches on `status.code`; a worker that exits is simply gone. The distinction
  that matters is *when* it exits: if it exits while the scheduler is still
  connecting, `connectEndpoint_p`'s `shouldContinue` short-circuits and the
  request is rejected with "The application exited during initialization."
  (`lib/scheduler/scheduler.js:267-270`).
- `kill(force = false)` (`lib/worker/app-worker.ts:520`) sends `SIGINT` to the
  *reported* pid, then `SIGTERM` after a hardcoded 20 s if the process hasn't
  exited. `kill(true)` skips straight to `SIGTERM` with no escalation. The
  `force` variant exists because of issue #494: R processes that had called
  `reticulate::source_python()` would swallow `SIGINT` and leak across a server
  restart, so `Scheduler.shutdown` uses `kill(true)`
  (`lib/scheduler/scheduler.js:296`).
- The child is spawned `detached: true` (`lib/worker/app-worker.ts:395`) so it
  gets its own process group. The inline comment says this is so signals reach
  the process `su` spawns; since the pid backchannel landed, the practical effect
  is more that the worker is insulated from signals sent to the server's group.
- If `spawn` succeeds but wiring up the listeners throws, the code kills either
  the reported pid or the direct child (`lib/worker/app-worker.ts:448-464`).
  A write error on the child's stdin also triggers `proc.kill()` (`:407-410`).
- **There is no temp-file or socket-file cleanup.** `Endpoint.free()` is a no-op
  for both transports (`lib/transport/tcp.js:165`,
  `lib/transport/unix-socket.js:126`); TCP ports need no cleanup, and the
  unix-socket transport (unused, see above) would leak `.sock` files.

**What the user sees on failure:** the scheduler attaches `err.consoleLogFile =
logFilePath` to whatever error propagates (`lib/scheduler/scheduler.js:145`), and
`ShinyProxy` renders the `error-500` template with the message "The application
failed to start.", the underlying error text, and the last 8 KB of the worker's
log file (`lib/proxy/http.js:212-216`, `fsutil.safeTail_p`). The log tail is
suppressed when `sanitize_errors` is on (`lib/proxy/http.js:42` in the excerpt at
`error500`), which is the default. This is why worker logs of failed launches are
never auto-deleted.

## The TypeScript story

`tsconfig.json` is `strict` with `include: ["lib/**/*.ts"]` and no `outDir`, so
`npm run build` (`tsc`) emits `.js` **next to** each `.ts`. Those emitted files
are committed (`.gitignore` does not exclude them) and are what actually runs —
`lib/scheduler/scheduler.js:28` requires `../worker/app-worker`, resolving to the
`.js`. **Editing `app-worker.ts` without running `npm run build` changes
nothing at runtime and nothing in the tests**, since `test/app-worker.js` rewires
the compiled `.js` too (`test/app-worker.js:11`).

Typing escape hatches to be aware of:

- Untyped neighbors are pulled in with `var x = require(...)` rather than
  `import`, which yields `any` and skips module resolution entirely: `path`,
  `bash`, `map`, `paths`, `permissions`, `userDb`
  (`lib/worker/app-worker.ts:25-32`). A side effect: `logDir` in `createLogFile`
  is `any` (it comes from the untyped `path.dirname`), which is the only reason
  `logDir = null` on the error path type-checks (`:210`, `:213`).
- Two hand-written declaration files paper over JS modules:
  `lib/transport/tcp.d.ts` and `lib/core/fsutil.d.ts`.
- `lib/globals.d.ts` declares the ambient `logger` and `SHINY_SERVER_VERSION`
  globals and augments `q`'s `Promise` with the project's `.eat()` / `.done()`
  helpers from `lib/core/qutil.js`.
- The `logStream: fs.WriteStream | string` union is load-bearing — the `string`
  arm means "the worker writes its own log", and every write site guards with
  `typeof logStream !== "string"`.

## Other gotchas

- `rprog` and both adapter script paths are resolved once at module load
  (`lib/worker/app-worker.ts:37-39`) via `paths.projectFile`, which is relative
  to the repo/install root (`lib/core/paths.js:15`). Adapter scripts must ship
  alongside `lib/`.
- `bookmarkStateDir` is optional in the `ShinyInput` type, so `JSON.stringify`
  would omit the key if it were `undefined`; `R/SockJSAdapter.R:61` then does
  `nchar(NULL) > 0` inside an `if`, which is an error in R. In practice the
  config layer always supplies a string, so this is latent rather than live.
- `reconnect` and `sanitizeErrors` are JSON booleans, but R compares them as
  `identical("true", tolower(input$reconnect))` (`R/SockJSAdapter.R:47-48`).
  This works only because `tolower(TRUE)` is `"true"`; sending strings instead of
  booleans would also work, but sending anything else would silently mean
  "false".
- `gaTrackingId` and `logFilePath` are coerced to `""` rather than left undefined
  (`lib/worker/app-worker.ts:569`, `:575`) specifically because R's `Sys.setenv`
  cannot take a `NULL`.
- The `AppWorker` returned by `launchWorker_p` may briefly have `pid === null`;
  `test/app-worker.js:189` notes the analogous "`$proc` isn't populated yet"
  window as a design wart.
