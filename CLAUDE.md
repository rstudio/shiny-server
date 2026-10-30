# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Shiny Server is an open-source (AGPLv3) Node.js server for hosting R Shiny applications, R Markdown documents, and Python Shiny apps over the web. It manages worker processes, proxies HTTP/WebSocket traffic to them, and supports multi-user and multi-app configurations.

## Memory Bank

The `memory-bank/` directory contains architectural documentation, with YAML frontmatter (`title`, `description`) on each file. **Before exploring the codebase, invoke the `memory-bank` skill** to discover and read the relevant documents — they provide context that should guide any code exploration, and they record verified findings (including known bugs and dead code) that are expensive to rediscover.

### Key Architecture Documents

- `projectbrief.md` — What Shiny Server is, deployment model, subsystem map, maintenance posture. **Read first when orienting.**
- `requestLifecycle.md` — The spine document: startup order, middleware stack, and the end-to-end dispatch of HTTP / WebSocket / SockJS requests. Read this when you need the whole story rather than one layer.
- `systemPatterns.md` — Code conventions: the IIFE prototype block, inheritance styles, the global `logger`, Q and the `_p` suffix, the "commit the compiled `.js`" rule. **Read before writing or reviewing code in `lib/`.**
- `techContext.md` — Dependency set and pinned forks, shrinkwrap policy, license compliance, TypeScript adoption, Node version pinning, day-to-day commands.
- `configSystem.md` — The bespoke config language: lexer, parser, schema, inheritance, per-app overlays, adding a directive.
- `routerChain.md` — URL → `AppSpec` resolution, the router wrapper stack, `AppSpec.getKey()` and scheduler pooling.
- `proxyLayer.md` — `ShinyProxy`, the three traffic paths, connection accounting, SockJS robustness and multiplexing.
- `schedulerSystem.md` — Worker pooling, `WorkerEntry` reference counting, idle reaping, capacity limits.
- `appWorkers.md` — How an R/Python app process is actually launched, the stdin handshake, per-worker logging, teardown.
- `transportLayer.md` — TCP vs. Unix socket endpoints, the per-worker shared secret.
- `nativePrivileges.md` — The launcher binary, command-backed account lookups, the pidfile lock, and the root/`run_as` privilege model.
- `coreUtilities.md` — The `lib/core/` helper inventory and the Q promise idioms.
- `loggingAndErrors.md` — The three log streams, error-to-HTTP-response path, `sanitize_errors`, template cascade.
- `testingGuide.md` — Test runner setup, Rewire/Sinon patterns, the honest coverage map, traps.
- `buildAndPackaging.md` — CMake, vendored Node and pandoc, deb/rpm, service registration, CI.

### Updating the Memory Bank

Update it when: discovering an architectural pattern worth recording, after significant changes to core architecture, when the user asks to **update memory bank**, or when important context needs clarifying. Keep the frontmatter `description` in sync with the content — it is what an agent reads to decide whether to open the file.

## Common Commands

**Install dependencies:**
```bash
npm install
```

**Build TypeScript:**
```bash
npm run build        # compiles lib/**/*.ts via tsc
```

**Run all tests:**
```bash
npm test             # mocha test/
```

**Run a single test file:**
```bash
npx mocha test/scheduler.js
```

**License check (run after updating dependencies, required before release):**
```bash
tools/preflight.sh
```

**Start the server (requires config and root/appropriate permissions):**
```bash
npm start -- --config config/default.config
```

**Run a local dev server (no root required):**
```bash
npm run dev          # nodemon against dev/shiny-server.conf, port 3838
```

> **First run: provision the Python sample app.** `dev/apps/py-hello` is a `uv`
> project, and `dev/.gitignore` ignores `**/.venv/`, so a fresh clone has no
> virtualenv and `/py-hello/` returns a 500. Nothing creates it for you:
>
> ```bash
> uv sync --project dev/apps/py-hello
> ```
>
> `/r-hello/` is unaffected — it needs only R and the `shiny` package.

## Architecture

### Request Flow

1. **`lib/main.js`** — Entry point. Parses CLI args, loads config, sets up Express app with middleware, creates the router/proxy hierarchy, and starts HTTP server(s).

2. **Config system (`lib/config/`)** — Custom config language with its own lexer, parser, and schema validator. Config files use an nginx-like block syntax with `server { listen ...; location / { ... } }` directives. Per-app config overlays are supported via `shiny-server-rules.config`.

3. **Router chain (`lib/router/`)** — Routers receive a request and return an `AppSpec` (app metadata), `true` (already handled), or falsy (not my route). Key routers:
   - `ConfigRouter` — main router, maps URL paths to apps based on config
   - `DirectoryRouter` — generates directory listings
   - `LocalConfigRouter` — per-app config overlays
   - `UserDirsRouter` — routes to user home directories (`~username/`)
   - `RestartRouter` — checks for `restart.txt` to trigger app restarts

4. **Proxy layer (`lib/proxy/`)** — `ShinyProxy` (in `http.js`) takes an incoming request, resolves it to an `AppSpec` via the router, asks the scheduler for a worker, and proxies the request. Supports HTTP, WebSocket, and SockJS fallback.

5. **Scheduler (`lib/scheduler/`)** — Manages pools of worker processes per app. Handles spawning, health tracking, idle timeouts, and session counting. `SchedulerRegistry` maps `AppSpec` keys to scheduler instances. Note there is *no* spawn backoff: a crash-looping app forks a fresh process per request (see `memory-bank/schedulerSystem.md`).

6. **Workers (`lib/worker/`)** — `AppWorker` (TypeScript) launches Shiny app processes as the configured `run_as` user by shelling out to `su`, and captures stderr to log files. Supports R Shiny, Python Shiny (`shiny-python` mode), and R Markdown (`rmd` mode).

7. **Native code (`src/`)** — `launcher.cc` is the project's only C++ source. It is built by CMake (`src/CMakeLists.txt`) into the standalone `shiny-server` binary, a path-discovery trampoline that `execv`s the bundled Node; it is not setuid and does no user switching. Account lookups are command-backed (`lib/core/user-db.js`: `getent`/`id` on Linux, `id`/`dscacheutil` on macOS, so NSS/Directory Service accounts resolve), and the `--pidfile` lock is a BSD descriptor lock taken by a short-lived `flock`/`lockf` helper (`lib/core/pidfile.js`).

### Key Data Types

- **`AppSpec`** (`lib/worker/app-spec.ts`) — Describes an application: `appDir`, `runAs` user, URL `prefix`, `logDir`, `settings` (mode, scheduler config, etc.)
- **Router interface** — `router.getAppSpec_p(req, res)` returns a promise of `AppSpec | true | falsy`

### TypeScript

The project is incrementally adopting TypeScript. `.ts` files live alongside `.js` files in `lib/`, and **the compiled `.js` output is committed to git**. TypeScript is configured with strict mode (`tsconfig.json`). Always run `npm run build` after editing `.ts` files and commit the regenerated `.js` — an edit to a `.ts` file alone changes nothing at runtime.

### Testing

Tests use Mocha with Should.js assertions, Sinon for mocking, and Rewire for module-level dependency injection. Mocha auto-requires `should`, `./lib/core/log`, and `./lib/core/qutil` (see `.mocharc.json`) — the latter two install the global `logger` and the `.eat()` promise extension that modules under test assume are already present. Tests are plain `.js` files in `test/`.

### Node.js Version

Specified in `.nvmrc`. The build system installs its own Node via `external/node/install-node.sh` into `ext/node`.

### Promises

Legacy code uses the Q promise library (`lib/core/qutil.js` provides helpers). The `_p` suffix convention on method names indicates a function returns a promise (e.g., `getAppSpec_p`). Newer TypeScript code uses native `async`/`await` internally but still returns `Q.Promise` at seams that JS callers touch.
