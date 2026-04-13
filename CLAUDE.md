# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Shiny Server is an open-source (AGPLv3) Node.js server for hosting R Shiny applications, R Markdown documents, and Python Shiny apps over the web. It manages worker processes, proxies HTTP/WebSocket traffic to them, and supports multi-user and multi-app configurations.

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

5. **Scheduler (`lib/scheduler/`)** — Manages pools of worker processes per app. Handles spawning with exponential backoff, health tracking, idle timeouts, and session counting. `SchedulerRegistry` maps `AppSpec` keys to scheduler instances.

6. **Workers (`lib/worker/`)** — `AppWorker` (TypeScript) launches Shiny app processes with correct user/group permissions, captures stderr to log files. Supports R Shiny, Python Shiny (`shiny-python` mode), and R Markdown (`rmd` mode).

7. **Native code (`src/`)** — C++ launcher (`launcher.cc`) and POSIX bindings (`posix.cc`) compiled via node-gyp. Provides user/group switching and Unix permissions management.

### Key Data Types

- **`AppSpec`** (`lib/worker/app-spec.ts`) — Describes an application: `appDir`, `runAs` user, URL `prefix`, `logDir`, `settings` (mode, scheduler config, etc.)
- **Router interface** — `router.getAppSpec_p(req, res)` returns a promise of `AppSpec | true | falsy`

### TypeScript

The project is incrementally adopting TypeScript. `.ts` files live alongside `.js` files in `lib/`. TypeScript is configured with strict mode (`tsconfig.json`). Always run `npm run build` after editing `.ts` files.

### Testing

Tests use Mocha with Should.js assertions, Sinon for mocking, and Rewire for module-level dependency injection. Mocha auto-requires `should`, `./lib/core/log`, and `./lib/core/qutil` (see `.mocharc.json`). Tests are plain `.js` files in `test/`.

### Node.js Version

Specified in `.nvmrc`. The build system installs its own Node via `external/node/install-node.sh`.

### Promises

Legacy code uses the Q promise library (`lib/core/qutil.js` provides helpers). The `_p` suffix convention on method names indicates a function returns a promise (e.g., `getAppSpec_p`).
