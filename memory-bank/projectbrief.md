---
title: Project Brief
description: What Shiny Server is, who runs it, the deployment shape it assumes (Linux, root, multi-user, per-app worker processes), its relationship to Shiny Server Pro and shiny-server-client, the subsystem map, and the project's maintenance posture. Read this first when orienting in the codebase.
---

# Project Brief: Shiny Server

## What it is

Shiny Server is a **long-running Node.js daemon that publishes R and Python
Shiny applications over HTTP**. It is not a framework and not a library — it is
a piece of server infrastructure that a sysadmin installs on a Linux box,
points at a directory of apps, and leaves running.

Its single job: turn `http://host:3838/my-app/` into a live, per-user session
of an R (or Python) process running `shiny::runApp()`, and keep that
relationship healthy — starting processes on demand, proxying HTTP and
WebSocket traffic to them, isolating them by Unix user, capturing their logs,
and reaping them when idle.

- **License:** AGPLv3. Open source, in `rstudio/shiny-server` on GitHub.
- **Version:** 1.5.x series (see `package.json` and `NEWS`).
- **Owner:** Posit (formerly RStudio).

## Who runs it and how

The assumed deployment is a **single Linux server, Shiny Server started as
root by an init system** (systemd on modern distros; SysV init and Upstart
scripts are still shipped for older ones). Root is required so that each app
can be launched as a *different* Unix user — this is the core isolation
mechanism, and most of the native C++ code exists to serve it.

Three hosting patterns are supported, and the config language is shaped around
them:

1. **App directory hosting** — a directory such as `/srv/shiny-server/` where
   each subdirectory is an app, all run as one service account. This is the
   default config.
2. **User directories** — `http://host/~jsmith/app/` serves apps out of
   `/home/jsmith/ShinyApps/app`, run as `jsmith`. This is the multi-tenant
   story on a shared analytics box.
3. **Single-app hosting** — one `location` block bound to one app directory.

A single config file (`/etc/shiny-server/shiny-server.conf`) drives all of it,
in a bespoke nginx-flavored language with its own lexer and parser.

## What it hosts

Three app *modes* — the `mode` setting on an `AppSpec`, switched on at
`lib/worker/app-worker.ts:345` — plus plain static serving for everything that
isn't an app:

- **`shiny`** — R Shiny apps (`ui.R`/`server.R` or `app.R`)
- **`rmd`** — R Markdown documents with `runtime: shiny`, including prerendered
  Quarto `server: shiny` documents. Shares the R spawn path with `shiny`; the
  difference is in what the adapter script is told to run.
- **`shiny-python`** — Python Shiny apps, including Shiny Express syntax. This
  is the one mode with a genuinely separate spawn path.

Static files and directory indexes are handled before the worker machinery is
ever reached.

## Architectural shape

Four layers, each with its own memory-bank document:

```
  browser
    │  HTTP / WebSocket / SockJS fallback
    ▼
  main.js ──── config/ ────────── the bespoke config language
    │                             (configSystem.md)
    ▼
  router/  ─── URL → AppSpec      (routerChain.md)
    │
    ▼
  proxy/   ─── ShinyProxy: byte plumbing, session accounting
    │                             (proxyLayer.md)
    ▼
  scheduler/ ─ pool of workers per AppSpec, idle reaping
    │                             (schedulerSystem.md)
    ▼
  worker/  ─── spawn R/Python as the right Unix user
    │                             (appWorkers.md, nativePrivileges.md)
    ▼
  R/SockJSAdapter.R  or  python/SockJSAdapter.py
    │  TCP port or Unix socket    (transportLayer.md)
    ▼
  the app process
```

The end-to-end walk-through of a single request lives in
`memory-bank/requestLifecycle.md`; start there when you need the whole story
rather than one layer of it.

Cross-cutting concerns: `coreUtilities.md` (the `lib/core/` helper layer and
the Q promise idioms), `loggingAndErrors.md`, `systemPatterns.md` (the coding
conventions), `techContext.md` (stack and developer workflow),
`buildAndPackaging.md` (CMake, vendored Node, deb/rpm), and `testingGuide.md`.

## Key relationships outside this repo

- **`shiny-server-client`** (`rstudio/shiny-server-client`, a pinned GitHub
  dependency) — the browser-side counterpart. It implements the SockJS
  fallback, the multiplexed-channel protocol, and reconnect/robust-connection
  logic. The wire protocol in `lib/proxy/multiplex.js` and
  `lib/proxy/robust-sockjs.js` is only meaningful in pair with it; changing one
  side means changing both.
- **The `shiny` R package and `shiny` Python package** — the apps themselves.
  Shiny Server does not depend on a particular version, but the adapter scripts
  in `R/` and `python/` do assume a supported API surface.
- **Shiny Server Pro (SSP)** — a closed-source commercial product built on this
  codebase. Several extension seams exist mainly to serve it: the `Scheduler`
  base class with only `SimpleScheduler` implemented in OSS, and various config
  directives declared but unused here. When something looks over-abstracted for
  what OSS does, Pro is usually the reason.

## Maintenance posture

This is a **mature, low-churn product in maintenance mode**. It has been in
production for over a decade. Recent commit history is dominated by dependency
refreshes, Node.js version bumps, and security-audit cleanup rather than
feature work.

Practical consequences for anyone working in here:

- **Backward compatibility is close to sacred.** Existing config files, log
  paths, and URL shapes are load-bearing for installations that nobody in this
  repo can see. Changing a default is a bigger deal than it looks.
- **The code is old-style Node** — Q promises, `util.inherits`, EventEmitter,
  callbacks — and it is *deliberately* not being modernized wholesale.
  New code should match the surrounding style rather than import a new
  paradigm. See `systemPatterns.md`.
- **Test coverage is partial.** Some subsystems have real unit tests; others
  have none and are only exercised by hand. `testingGuide.md` has the honest
  map.
- **The build is heavier than the code.** CMake, a vendored Node runtime, a
  vendored pandoc, and deb/rpm packaging surround an
  ~8k-line `lib/` tree. Most "it doesn't work" problems on a dev machine are
  build/environment problems, not code problems.
