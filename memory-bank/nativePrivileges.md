---
title: Native Components And The Privilege Model
description: What the two C++ pieces of shiny-server actually do — the `posix` node-gyp addon (src/posix.cc: getpwnam/getpwuid/getgrouplist/getgrnam/acquireRecordLock, all read-only) and the `shiny-server` launcher binary (src/launcher.cc: a non-setuid exec trampoline built by CMake, NOT a privilege helper, despite CLAUDE.md) — plus the real privilege model: server stays root, workers drop to `run_as` by shelling out to `su`, supplementary groups, root-vs-non-root config validation, macOS/dev vs Linux, and the node-gyp-vs-CMake build split. Read before touching user switching, `run_as`, log-file ownership, `members_of`, the pidfile lock, or anything under src/.
---

# Native Components And The Privilege Model

Shiny Server has exactly two pieces of C++:

1. **`posix`** — a Node addon (`src/posix.cc`, built by `binding.gyp`) that
   exposes a handful of POSIX identity calls Node doesn't provide.
2. **`shiny-server`** — a standalone native executable (`src/launcher.cc`, built
   by CMake) that is the entry point installed on `PATH`.

Neither is setuid, and **neither performs any privilege transition.** All the
actual privilege work happens in JavaScript and in `su`.

> ## Correcting the record
>
> The project's `CLAUDE.md:62` says of `src/`: *"C++ launcher (`launcher.cc`)
> and POSIX bindings (`posix.cc`) compiled via node-gyp. Provides user/group
> switching and Unix permissions management."* **Two of those three claims are
> wrong**, and they are a persistent source of confusion:
>
> - `src/launcher.cc` never calls `setuid`, `setgid`, `initgroups`, or `su`. It
>   is a ~128-line front-end shim that locates the install base directory and
>   `execv`s into the bundled Node. It is not setuid, and nothing in
>   `packaging/` sets a setuid bit on it.
> - `src/posix.cc` is **read-only and informational**: passwd/group *lookups*
>   plus one `fcntl` record lock. It changes no identity and manages no
>   permissions.
> - Real `run_as` user switching is done by shelling out to `su` from
>   `lib/worker/app-worker.ts` (`wrapWithUserSwitch`, line 654). The only native
>   involvement is `posix.getpwnam` to resolve the username.
> - `lib/worker/run-as.js` *does* contain `setuid`/`setgid`/`initgroups`, but it
>   is **dead code** — nothing in `lib/`, `test/`, `tools/`, `scripts/`, or
>   `src/` requires it. Do not read it as the live mechanism.
> - Only `posix.cc` is compiled by node-gyp. `launcher.cc` is built by **CMake**
>   (`src/CMakeLists.txt`); node-gyp never sees it (`binding.gyp:1-10` lists
>   `src/posix.cc` as its sole source). See "Build wiring" below.

## The `posix` addon — what Node can't do

Node's built-ins cover *changing* identity (`process.setuid`, `setgid`,
`initgroups`) but not *querying* the user/group databases, and not POSIX record
locks. `src/posix.cc:282-288` exports five functions:

| Export | Backed by | Used for |
|---|---|---|
| `getpwnam(name)` | `getpwnam_r` (`src/posix.cc:57`) | resolve `run_as` user → uid/gid/home/shell (`lib/scheduler/scheduler.js:171`, `lib/router/user-dirs-router.js:66`) |
| `getpwuid(uid)` | `getpwuid_r` (`src/posix.cc:98`) | name of the current process user (`lib/core/permissions.js:30`) |
| `getgrouplist(name)` | `getgrouplist` (`src/posix.cc:141`) | **supplementary groups** of a user, for `members_of` access control (`lib/router/user-dirs-router.js:72`) |
| `getgrnam(name)` | `getgrnam` (`src/posix.cc:209`) | group name → gid when parsing `members_of` (`lib/router/config-router.js:441`) |
| `acquireRecordLock(fd, type, whence, start, len)` | `fcntl(F_SETLK)` (`src/posix.cc:247`) | non-blocking exclusive lock on the pidfile (`lib/core/fsutil.js:144`) |

Notes and portability details worth knowing:

- All lookups return `null` (not an error) when the entry simply doesn't exist —
  the code distinguishes "not found" from "error" by checking `errno == 0`
  (`src/posix.cc:75-84`). Callers rely on this: `lib/worker/app-worker.ts:124`
  rejects with "User X does not exist" on a `null` pw.
- `getgrouplist`'s result type differs by platform: `gid_t` on Linux, `int` on
  BSD/macOS, and on BSD a non-zero return is an error while on Linux it isn't
  (`src/posix.cc:158-193`). It retries up to 3 times, growing the buffer from an
  initial 64 groups (`src/posix.cc:176-203`).
- `acquireRecordLock` returns `false` (rather than throwing) for
  `EACCES`/`EAGAIN` — i.e. "someone else holds it"
  (`src/posix.cc:268-275`). `createPidFile` (`lib/core/fsutil.js:141-155`) turns
  that into the "Is another instance of shiny-server running?" error at
  `lib/main.js:85-88`. A record lock (not a lockfile) is used so the lock dies
  with the process, even on SIGKILL.
- The addon is loaded by **absolute relative path** — `require('../../build/Release/posix')`
  in `lib/core/permissions.js:13`, `lib/core/fsutil.js:16`,
  `lib/scheduler/scheduler.js:29`, `lib/worker/app-worker.ts:32`,
  `lib/router/router.js:22`, `lib/router/user-dirs-router.js:16`,
  `lib/router/config-router.js:26`, `lib/worker/run-as.js:22`. There is no
  `bindings`-style resolution and no Debug fallback, so `build/Release/posix.node`
  must exist or the server won't boot. This is why `build/` is one of the
  directories installed into the package (`CMakeLists.txt:40`).

## The `launcher` binary — a path-discovery trampoline, not a setuid helper

`src/launcher.cc` is **not** setuid; nothing in `packaging/` sets a setuid bit,
and the systemd unit runs the process as root by omission (no `User=` in
`config/systemd/shiny-server.service`). Its stated purpose
(`src/launcher.cc:33-34`) is "to provide a clean entry point for shiny-server,
that is capable of running either daemonized or not."

What it actually does (`src/launcher.cc:38-66`):

1. Find its own absolute path, then take `dirname(dirname(...))`
   (`src/launcher.cc:125`) — so a binary at `/opt/shiny-server/bin/shiny-server`
   yields base dir `/opt/shiny-server`.
2. Build `<base>/ext/node/bin/shiny-server` and `<base>/lib/main.js`
   (`src/launcher.cc:45-46`).
3. `execv` the bundled Node with `main.js` prepended to the original argv
   (`src/launcher.cc:49-58`). Argument contract: **argv[0] is discarded**;
   `argv[1..]` are forwarded verbatim as `argv[2..]` of the new process. So
   `shiny-server --pidfile /x` becomes
   `<base>/ext/node/bin/shiny-server <base>/lib/main.js --pidfile /x`.
   `execv` replaces the image, so it inherits the same pid, uid, fds, and
   environment.

Why a native binary instead of a shell script:

- **Self-location without `$0` games.** Path discovery is platform-specific:
  `readlink("/proc/<pid>/exe")` on Linux (`src/launcher.cc:74-113`),
  `_NSGetExecutablePath` on macOS (`src/launcher.cc:114-120`), and a hard
  `#error "Unsupported platform"` otherwise (`src/launcher.cc:121-123`). This
  makes the install relocatable — the whole tree can live anywhere.
- **Same-pid exec**, which is what makes systemd's `Type=simple` /
  `$MAINPID` (`config/systemd/shiny-server.service`) and the pidfile agree.
- **Process name.** `external/node/install-node.sh:61` copies `ext/node/bin/node`
  to `ext/node/bin/shiny-server` purely so that `ps` shows `shiny-server` rather
  than `node`. `install-node.sh:62` then deletes the bundled `npm`.

`src/launcher.h.in` defines `SHINY_SERVER_DEFAULT_BIN_PATH` from
`${CMAKE_INSTALL_PREFIX}`, but **`launcher.cc` never references it** — it is
dead configuration left over from an earlier design. The generated `src/launcher.h`
is gitignored (`.gitignore:9`), as is the built `bin/shiny-server`
(`.gitignore:5`).

## The privilege model

**The server process stays root for its entire life.** There is no
`process.setuid` anywhere in `lib/main.js` or the request path. The only
`setuid`/`setgid`/`initgroups` calls anywhere in the tree are in the dead
`lib/worker/run-as.js:29-31` (see below). Root is retained because the server
must:

- bind privileged ports (`listen 80`),
- `getpwnam` arbitrary users and read their home dirs (`user_dirs`, `user_apps`),
- create and `chown` per-app log files and bookmark-state dirs to the app user
  (`lib/worker/app-worker.ts:193-250`, `:256-305`),
- and, crucially, `su` to *any* `run_as` user.

**Workers drop privileges via `su`, not via `setuid` in Node, and not via any
native code.** The rationale is in the comment at
`lib/worker/app-worker.ts:314-316`: "Spawn worker process via `su`, to ensure
proper `setgid`, `initgroups`, `setuid`, etc. are called correctly." Delegating
to `su` also gets the login-session machinery (PAM on Linux), environment
initialization, and supplementary groups for free rather than reimplementing
them.

The construction of that command lives in `wrapWithUserSwitch`
(`lib/worker/app-worker.ts:654-682`) and is documented in detail in
`memory-bank/appWorkers.md`. Two facts matter for the privilege story:

- Every path and argument is passed through `bash.escape()`
  (`app-worker.ts:662-664`) before landing inside `su ... -c "<string>"`. That
  is the injection boundary; do not add an unescaped interpolation there.
- The child is spawned `detached: true` (`lib/worker/app-worker.ts:391-397`) so
  signals reach the whole process group — `su` forks the real worker, and
  killing only `su` would orphan the app.

### Security invariants

- **`lib/worker/app-worker.ts:334-335`: never launch a worker as root.** If the
  server is superuser and `switchUser` is false (meaning `appSpec.runAs` equals
  the current user, i.e. root), it throws "Aborting attempt to launch worker
  process as root". `switchUser` is computed at `app-worker.ts:325-326` as
  `runAs !== null && processUser !== runAs`.
- **`appSpec.runAs` must be a plain string by launch time.** `run_as` in config
  can hold a *list* (including the `:HOME_USER:` keyword); `SquashRunAsRouter`
  (`lib/router/squash-run-as-router.js`, wired at `lib/main.js:46`) collapses it,
  and `app-worker.ts:328-332` asserts the collapse happened. A non-string here
  would reach the `su` command line.
- **`permissions.canRunAs(user)`** (`lib/core/permissions.js:37-39`) is the
  single definition of "may I become this user": true iff we are root, or the
  user *is* us. Config validation uses it (`lib/router/config-router.js:44-48`).
- **Worker addresses/secrets never appear in argv.** The whole `ShinyInput` blob
  goes over stdin specifically so `ps` can't leak it
  (`lib/worker/app-worker.ts:317-319`). See `memory-bank/transportLayer.md`.
- **Stdin, not env, for secrets** — but note `lib/worker/run-as.js:44-47` (dead
  code) does pass `SHINY_PORT` via environment.

### Supplementary groups

Two distinct uses, both via the `posix` addon:

- **Access control (`members_of`).** `lib/router/config-router.js:436-451`
  resolves each configured group name to a gid with `posix.getgrnam` at config
  parse time (failing fast on unknown groups). At request time,
  `lib/router/user-dirs-router.js:71-74` calls `posix.getgrouplist(username)` and
  intersects with those gids; an empty intersection means the request resolves to
  no app (a 404), not a 403.
- **Worker identity.** Supplementary groups for the worker process itself are
  established by `su`, not by Node — that is one of the main reasons `su` is used
  (`lib/worker/app-worker.ts:314-316`).

### Root vs. non-root startup

`checkPermissions()` (`lib/router/config-router.js:42-100`), called from
`createRouter_p` at `config-router.js:37`, validates the config against the
current identity *before* the router is built:

- **As root:** if the config uses exactly one `run_as` user, no `user_apps`/
  `user_dirs`, and no port under 1024, it logs "Running as root unnecessarily is
  a security risk!" (`config-router.js:67-71`) and otherwise proceeds.
- **As non-root:** it throws a config-node-attributed error for any `run_as` the
  process can't satisfy (`config-router.js:78-85`), for `user_apps`
  (`:87-90`), for `user_dirs` (`:91-94`), and for `listen` ports below 1024
  (`:96-100`). Errors go through `throwForNode` so the message points at the
  offending config line.

This means a non-root dev instance works fine as long as `run_as` names the
developer's own account and the port is ≥1024 — the standard
`npm start -- --config ...` workflow.

### `lib/worker/run-as.js` is dead code

Nothing references it (grep for `run-as` finds only `squash-run-as-router.js`).
It's a leftover alternative to `su`: drop privileges in-process with
`posix.getpwnam` + `setgid`/`initgroups`/`setuid`
(`lib/worker/run-as.js:27-31`), then `spawn` the real command with a hand-built
env. It also only forwards four `SHINY_*` env vars
(`run-as.js:44-47`), which predates the stdin-based `ShinyInput` protocol. Treat
it as historical; don't wire it back up without revisiting the escaping and env
story.

## macOS / dev vs. production Linux

The codebase supports macOS well enough to develop and test on, but not to
deploy on:

- `src/launcher.cc` compiles on Linux and macOS only
  (`src/launcher.cc:74`, `:114`, `:121-123`).
- `src/posix.cc:158-162` and `:188-193` branch on `__linux__` for `getgrouplist`
  types and error conventions.
- `wrapWithUserSwitch` (`lib/worker/app-worker.ts:667-673`) uses a different
  `su` invocation on non-Linux because macOS `su` lacks `-s`.
- Defaults such as `/var/shiny-server/sockets`, `/srv/shiny-server`, and
  `/var/log/shiny-server` (`config/default.config`) don't exist on a Mac; dev
  usually runs non-root with a custom config.
- Packaging (deb/rpm via CPack, `CMakeLists.txt:80+`) is Linux-only, and the
  `shiny` service account is created (`useradd -r -m shiny`) by the postinst
  scripts (`packaging/debian-control/postinst.in:7-16`), which also symlink
  `/usr/bin/shiny-server` to the launcher (`postinst.in:6`) and chown
  `/var/log/shiny-server` to `shiny` (`postinst.in:41`).
- Running non-root on a dev box means `permissions.isSuperuser()` is false, so
  workers are spawned **without** `su` at all (`app-worker.ts:325-326`,
  `:373-375`) — the user-switching path is effectively untested locally. Keep
  that in mind when changing it.

## Build wiring — two build systems, two artifacts

**node-gyp / `binding.gyp` → `build/Release/posix.node`.** `binding.gyp` is
minimal (`binding.gyp:1-10`): one target `posix`, one source `src/posix.cc`, and
an include dir resolved by shelling out to `node -e "require('nan')"`. NAN is a
regular npm dependency (`nan` in `package.json`), so the addon is rebuilt
automatically by `npm install`. `binding.gyp` itself is installed into the
package (`CMakeLists.txt:68`) so the addon can be rebuilt in place.

**CMake → `bin/shiny-server` (the launcher).** `src/CMakeLists.txt` is two
lines: `configure_file` for `launcher.h.in` → `src/launcher.h`, then
`add_executable(shiny-server launcher.cc)`. The top-level
`CMakeLists.txt:5` sets `CMAKE_RUNTIME_OUTPUT_DIRECTORY` to `<source>/bin`, so
the binary lands *in the source tree* at `bin/shiny-server` (gitignored) rather
than in a build dir. `CMakeLists.txt:57-61` then installs `bin/node`, `bin/npm`,
`bin/shiny-server`, and the generated `bin/deploy-example` into
`<prefix>/shiny-server/bin`.

**What CMake does not build:** the JS/TS. `CMakeLists.txt:38-52` installs
`lib`, `node_modules`, `build`, `R`, `python`, `ext`, etc. wholesale with
`USE_SOURCE_PERMISSIONS` — meaning `npm install` (which runs node-gyp and
produces `build/Release/posix.node`) and `npm run build` (tsc) must have been run
*before* CMake's install step. `external/pandoc` is a separate subproject
(`CMakeLists.txt:36`) and Node itself is downloaded by
`external/node/install-node.sh` into `ext/node`.

Layout of a finished install (`--prefix /opt` → `/opt/shiny-server/`):

```
/opt/shiny-server/bin/shiny-server        <- native launcher (src/launcher.cc)
/opt/shiny-server/ext/node/bin/shiny-server <- copy of node (install-node.sh:61)
/opt/shiny-server/lib/main.js             <- JS entry point
/opt/shiny-server/build/Release/posix.node<- node-gyp addon
```

The launcher's `dirname(dirname(argv0))` walk (`src/launcher.cc:125`) is exactly
what ties the first line to the other three.
