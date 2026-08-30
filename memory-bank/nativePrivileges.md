---
title: Native Components And The Privilege Model
description: What remains of shiny-server's native code — the `shiny-server` launcher binary (src/launcher.cc: a non-setuid exec trampoline built by CMake, NOT a privilege helper) — plus what replaced the deleted `posix` node-gyp addon: command-backed account lookups (lib/core/user-db.js: getent/id/dscacheutil, NSS/Directory Service aware) and BSD descriptor locking for the pidfile via a short-lived flock/lockf helper (lib/core/pidfile.js). Also the real privilege model: server stays root, workers drop to `run_as` by shelling out to `su`, supplementary groups, root-vs-non-root config validation, macOS/dev vs Linux. Read before touching user switching, `run_as`, log-file ownership, `members_of`, the pidfile lock, or anything under src/.
---

# Native Components And The Privilege Model

Shiny Server has exactly one piece of C++ left:

- **`shiny-server`** — a standalone native executable (`src/launcher.cc`, built
  by CMake) that is the entry point installed on `PATH`.

It is not setuid and **performs no privilege transition.** All the actual
privilege work happens in JavaScript and in `su`.

The second native artifact — the `posix` node-gyp addon (`src/posix.cc`,
`binding.gyp`, the `nan` dependency) — **was removed**. Its two jobs are now
done without native code:

1. **User/group/membership lookups** → `lib/core/user-db.js`, which shells out
   to platform account commands (see below).
2. **The `--pidfile` lock** → `lib/core/pidfile.js`, which has a short-lived
   `flock`/`lockf` helper take a BSD descriptor lock on an already-open fd.

## Account lookups — `lib/core/user-db.js`

Node's built-ins cover *changing* identity (`process.setuid`, `setgid`,
`initgroups`) but not *querying* the user/group databases. Instead of a native
addon, `user-db.js` runs the host's own account utilities, so lookups stay
aware of NSS (Linux) and Directory Service (macOS) — LDAP/SSSD/centrally
managed accounts resolve exactly as local ones do. Parsing `/etc/passwd` or
`/etc/group` directly is deliberately **not** a fallback; it would bypass that
directory.

Public surface:

| Function | Backed by (Linux / macOS) | Used for |
|---|---|---|
| `getCurrentUser()` | `os.userInfo()` | name of the current process user (`lib/core/permissions.js`) |
| `lookupUser_p(name)` | `getent -- passwd` / `id -P --` | resolve `run_as` user → `{name, uid, gid, home}` (`lib/scheduler/scheduler.js`, `lib/router/user-dirs-router.js`, `lib/worker/app-worker.ts`) |
| `lookupGroup(name)` (sync) | `getent -- group` / `dscacheutil -q group -a name` | group name → gid when parsing `members_of` (`lib/router/config-router.js`) |
| `getGroupIds_p(name)` | `id -G --` (both) | **supplementary groups** of a user, for `members_of` access control (`lib/router/user-dirs-router.js`) |

Contract details worth knowing:

- A clean "not found" maps to `null` (getent status 2, `id` status 1, empty
  `dscacheutil` output). Callers rely on this: `launchWorker_p`
  (`lib/worker/app-worker.ts`) rejects with "User X does not exist" on a null
  pw, and `user-dirs-router` treats null as fall-through (404, not 403).
  Command launch failures, unexpected exit statuses, and malformed successful
  output **throw/reject** — they are operational errors, not "not found".
- Commands are resolved from fixed system locations (`/usr/bin`, `/bin` on
  Linux; `/usr/bin` on macOS), never from the ambient `PATH`, and are invoked
  with argument arrays under `LC_ALL=C` — a username from a `user_dirs` URL
  travels as exactly one argv element and can never become an option or shell
  fragment.
- A lookup of the current effective username is fast-pathed through
  `os.userInfo()` and runs no external command; the normal non-root dev/test
  path therefore never spawns anything.
- `user_dirs` does these lookups on the request path, so positive results are
  cached for 5s and negative ones for 1s (bounded, oldest-evicted, concurrent
  lookups coalesced). The positive TTL bounds the access-control revocation
  delay, comparable to what NSS/Directory Service cache anyway.
- `lookupGroup` is synchronous because config construction is synchronous; it
  runs only for configured `members_of` groups at startup/reload.

## The pidfile lock — `lib/core/pidfile.js`

The lock behind `--pidfile` is a **BSD `flock(2)`-style descriptor lock**, not
a lockfile and not the old `fcntl(F_SETLK)` record lock:

1. Node opens the pidfile read/write without truncating it.
2. Node passes that descriptor as fd 3 to a short-lived helper:
   `/usr/bin/flock -n -E 75 3` on Linux (`/bin/flock` fallback),
   `/usr/bin/lockf -s -t 0 3` on macOS.
3. The helper takes an exclusive, nonblocking lock on fd 3 and exits. Because
   fd 3 shares Node's open file description, **the lock survives the helper's
   exit** — no helper process stays alive.
4. Node keeps its descriptor open until `release()` or process exit; the
   kernel drops the lock when the last descriptor closes, even on SIGKILL.

Contention is exit status 75 (EX_TEMPFAIL) on both platforms, and 75 is the
*only* status translated into the "Is another instance of Shiny Server
running?" result; anything else (missing helper, signal, timeout, unexpected
status) is a distinct startup error. Do not run the server under a `flock`
wrapper instead — that would change `$MAINPID`, signal behavior, and the PID
written to the file.

`release()` requires a prior successful `acquire()` by the module (an
absolute-path → `{fd, dev, ino}` ownership map): it unlinks only while still
holding the lock, only if the pathname still identifies the held inode and the
descriptor still contains this process's PID. A replaced pathname is left
alone.

One transition caveat: BSD `flock` and the old `fcntl` record lock are
separate lock domains on Linux. Package upgrades stop the old service before
starting the new one, so the supported path never overlaps them — but manually
running an old and a new server against the same pidfile is unsupported.

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
`process.setuid` anywhere in `lib/main.js` or the request path. Root is
retained because the server must:

- bind privileged ports (`listen 80`),
- resolve arbitrary users and read their home dirs (`user_dirs`, `user_apps`),
- create and `chown` per-app log files and bookmark-state dirs to the app user
  (`lib/worker/app-worker.ts`),
- and, crucially, `su` to *any* `run_as` user.

**Workers drop privileges via `su`, not via `setuid` in Node, and not via any
native code.** The rationale is in the comment at
`lib/worker/app-worker.ts:314-316`: "Spawn worker process via `su`, to ensure
proper `setgid`, `initgroups`, `setuid`, etc. are called correctly." Delegating
to `su` also gets the login-session machinery (PAM on Linux), environment
initialization, and supplementary groups for free rather than reimplementing
them.

The construction of that command lives in `wrapWithUserSwitch`
(`lib/worker/app-worker.ts`) and is documented in detail in
`memory-bank/appWorkers.md`. Two facts matter for the privilege story:

- Every path and argument is passed through `bash.escape()` before landing
  inside `su ... -c "<string>"`. That is the injection boundary; do not add an
  unescaped interpolation there.
- The child is spawned `detached: true` so signals reach the whole process
  group — `su` forks the real worker, and killing only `su` would orphan the
  app.

### Security invariants

- **Never launch a worker as root.** If the server is superuser and
  `switchUser` is false (meaning `appSpec.runAs` equals the current user, i.e.
  root), `createAppWorker` throws "Aborting attempt to launch worker process
  as root". `switchUser` is computed as `runAs !== null && processUser !==
  runAs`.
- **`appSpec.runAs` must be a plain string by launch time.** `run_as` in config
  can hold a *list* (including the `:HOME_USER:` keyword); `SquashRunAsRouter`
  (`lib/router/squash-run-as-router.js`, wired at `lib/main.js`) collapses it,
  and `app-worker.ts` asserts the collapse happened. A non-string here would
  reach the `su` command line.
- **`permissions.canRunAs(user)`** (`lib/core/permissions.js`) is the single
  definition of "may I become this user": true iff we are root, or the user
  *is* us. Config validation uses it (`lib/router/config-router.js`).
- **Worker addresses/secrets never appear in argv.** The whole `ShinyInput`
  blob goes over stdin specifically so `ps` can't leak it. See
  `memory-bank/transportLayer.md`.

### Supplementary groups

Two distinct uses:

- **Access control (`members_of`).** `lib/router/config-router.js` resolves
  each configured group name to a gid with `userDb.lookupGroup` at config parse
  time (failing fast on unknown groups). At request time,
  `lib/router/user-dirs-router.js` awaits `userDb.getGroupIds_p(username)` and
  intersects with those gids; an empty intersection means the request resolves
  to no app (a 404), not a 403.
- **Worker identity.** Supplementary groups for the worker process itself are
  established by `su`, not by Node — that is one of the main reasons `su` is
  used (`lib/worker/app-worker.ts`).

### Root vs. non-root startup

`checkPermissions()` (`lib/router/config-router.js`), called from
`createRouter_p`, validates the config against the current identity *before*
the router is built:

- **As root:** if the config uses exactly one `run_as` user, no `user_apps`/
  `user_dirs`, and no port under 1024, it logs "Running as root unnecessarily is
  a security risk!" and otherwise proceeds.
- **As non-root:** it throws a config-node-attributed error for any `run_as` the
  process can't satisfy, for `user_apps`, for `user_dirs`, and for `listen`
  ports below 1024. Errors go through `throwForNode` so the message points at
  the offending config line.

This means a non-root dev instance works fine as long as `run_as` names the
developer's own account and the port is ≥1024 — the standard
`npm start -- --config ...` workflow.

### `lib/worker/run-as.js` is gone

The old in-process alternative to `su` (`getpwnam` + `setgid`/`initgroups`/
`setuid`, forwarding four `SHINY_*` env vars) was dead code — nothing required
it — and was deleted along with the addon. Don't resurrect it without
revisiting the escaping and env story; `su` is the live mechanism.

## macOS / dev vs. production Linux

The codebase supports macOS well enough to develop and test on, but not to
deploy on:

- `src/launcher.cc` compiles on Linux and macOS only
  (`src/launcher.cc:74`, `:114`, `:121-123`).
- `lib/core/user-db.js` and `lib/core/pidfile.js` have Linux and macOS command
  tables only; any other platform gets a clear "unsupported platform" error
  when an account lookup or pidfile lock is requested.
- `wrapWithUserSwitch` (`lib/worker/app-worker.ts`) uses a different `su`
  invocation on non-Linux because macOS `su` lacks `-s`.
- Defaults such as `/var/shiny-server/sockets`, `/srv/shiny-server`, and
  `/var/log/shiny-server` (`config/default.config`) don't exist on a Mac; dev
  usually runs non-root with a custom config.
- Packaging (deb/rpm via CPack, `CMakeLists.txt:80+`) is Linux-only, and the
  `shiny` service account is created (`useradd -r -m shiny`) by the postinst
  scripts (`packaging/debian-control/postinst.in:7-16`), which also symlink
  `/usr/bin/shiny-server` to the launcher (`postinst.in:6`) and chown
  `/var/log/shiny-server` to `shiny` (`postinst.in:41`).
- Running non-root on a dev box means `permissions.isSuperuser()` is false, so
  workers are spawned **without** `su` at all — the user-switching path is
  effectively untested locally. Keep that in mind when changing it.

## Build wiring — one build system, one artifact

**CMake → `bin/shiny-server` (the launcher).** `src/CMakeLists.txt` is two
lines: `configure_file` for `launcher.h.in` → `src/launcher.h`, then
`add_executable(shiny-server launcher.cc)`. The top-level
`CMakeLists.txt:5` sets `CMAKE_RUNTIME_OUTPUT_DIRECTORY` to `<source>/bin`, so
the binary lands *in the source tree* at `bin/shiny-server` (gitignored) rather
than in a build dir. `CMakeLists.txt` then installs `bin/node`, `bin/npm`,
`bin/shiny-server`, and the generated `bin/deploy-example` into
`<prefix>/shiny-server/bin`.

There is no longer any node-gyp involvement anywhere: no `binding.gyp`, no
`nan` dependency, no `build/Release/posix.node`, and the root `build/`
directory is no longer package content. `npm install` needs no compiler,
Python, or Node headers, and a checkout is no longer coupled to the Node major
that last ran it.

**What CMake does not build:** the JS/TS. `CMakeLists.txt` installs `lib`,
`node_modules`, `R`, `python`, `ext`, etc. wholesale with
`USE_SOURCE_PERMISSIONS` — meaning `npm install` and `npm run build` (tsc)
must have been run *before* CMake's install step. `external/pandoc` is a
separate subproject and Node itself is downloaded by
`external/node/install-node.sh` into `ext/node`.

Layout of a finished install (`--prefix /opt` → `/opt/shiny-server/`):

```
/opt/shiny-server/bin/shiny-server        <- native launcher (src/launcher.cc)
/opt/shiny-server/ext/node/bin/shiny-server <- copy of node (install-node.sh:61)
/opt/shiny-server/lib/main.js             <- JS entry point
```

The launcher's `dirname(dirname(argv0))` walk (`src/launcher.cc:125`) is exactly
what ties the first line to the other two.
