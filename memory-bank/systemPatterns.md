---
title: System Patterns and Code Conventions
description: The recurring code idioms in this codebase — the IIFE prototype block, the three coexisting inheritance styles, the global `logger`, the `_p` promise convention and Q usage, the null-prototype `map` object, the license header, and the rules for TypeScript files whose compiled output is committed. Read before writing or reviewing code in `lib/`.
---

# System Patterns and Code Conventions

Shiny Server's `lib/` tree is roughly 8,000 lines of Node.js written mostly
between 2012 and 2014, with newer TypeScript grafted on at a few points. The
style is consistent and idiosyncratic. **Match it.** A modern refactor of one
file makes the codebase harder to read, not easier, because the reader loses the
ability to pattern-match across files.

This document is about *how the code is written*. For what it does, see
`projectbrief.md` and the per-subsystem docs.

## The IIFE prototype block

The signature idiom. A constructor is exported by name, then its prototype is
filled in by an immediately-invoked function applied to the prototype:

```js
exports.NullRouter = NullRouter;
function NullRouter() {
}
(function() {
  this.getAppSpec_p = function(req, res) {
    return Q.resolve(null);
  };
}).call(NullRouter.prototype);
```

`lib/router/router.js:29` is the smallest example. **22 of the ~30 non-trivial
modules in `lib/` use this form** — every router, every scheduler, the config
parser and lexer, the proxy, the transports, `Server`, and `AppWorkerHandle`.

The payoff is that `this` inside the block is the prototype, so methods can be
declared as plain `this.foo = function() {}` without repeating the constructor
name. It also gives a natural scope for private helpers shared by the methods.
The cost is that the class's methods are invisible to a naive grep for
`Foo.prototype.` — search for the constructor name and read the block below it.

Note the deliberate blank line placement: `exports.X = X;` sits directly *above*
the `function X` declaration, so a reader scanning for exports finds them
adjacent to their definitions rather than collected at the bottom.

## Three inheritance styles, all live

There is no single convention. All three of these appear, and none is being
migrated away from:

1. **`util.inherits(Sub, Base)`** — the most common. `lib/transport/tcp.js:92`,
   `lib/proxy/multiplex.js:108`, `lib/worker/app-worker-handle.js:28`,
   `lib/core/errors.js:11`, `lib/scheduler/simple-scheduler.js:27`.
2. **Direct `__proto__` assignment** — `Scheduler.prototype.__proto__ =
   events.EventEmitter.prototype` at `lib/scheduler/scheduler.js:44`, and the
   same at `lib/scheduler/scheduler-registry.js:43` and
   `lib/events/simple-event-bus.js:20`. Functionally equivalent to
   `util.inherits` here; historically it predates it.
3. **ES `class ... extends`** — only in the newest file,
   `lib/scheduler/worker-entry.js:37` (`class WorkerEntry extends
   EventEmitter`). This is where the codebase would go if it were being
   modernized, but it is a single data point, not a trend.

In cases 1 and 2 the constructor must still call the base constructor
explicitly: `events.EventEmitter.call(this)` as the first statement.

**When adding a class:** follow the file you're in. Don't convert a file's
existing style as a side effect of an unrelated change.

## EventEmitter as the default extension seam

Almost everything long-lived is an `EventEmitter`: `Server`, `Scheduler`,
`SchedulerRegistry`, `AppWorkerHandle`, `MultiplexSocket`, `MultiplexChannel`,
the `RobustConn`, and `SimpleEventBus`. Cross-layer communication tends to
happen by event rather than by callback or promise, which is why tracing a
value through the system often means grepping for an event *name* string rather
than a function.

## Promises: Q, and the `_p` suffix

The codebase uses **Q**, not native promises, for anything that predates the
TypeScript files. It is the one dependency deliberately excluded from the
"upgrade everything" commits (see `git log`), because Q's API surface —
`.fail`, `.fin`, `.done`, deferreds — is used pervasively and a migration would
touch every file.

**The `_p` suffix on a name means "returns a promise."** This is the single most
important naming convention in the codebase: `getAppSpec_p`, `connectEndpoint_p`,
`forEachPromise_p`. A function without `_p` is synchronous or callback-based.
Preserve the convention on any new function.

`lib/core/qutil.js` holds the shared promise helpers, and also monkey-patches
Q's prototype:

- **`promise.eat()`** (`lib/core/qutil.js:20`) — swallow a rejection. Attached
  to `Q.makePromise.prototype`, so it is available on *every* Q promise in the
  process, in any file, with no import. Seeing a bare `.eat()` on a promise is
  not a typo.
- **`qutil.serialized(func)`** (`lib/core/qutil.js:25`) — wraps a
  promise-returning function so that concurrent invocations queue rather than
  overlap. Used where reentrancy would corrupt state.

`lib/globals.d.ts` re-declares `eat()` and `done()` on Q's `Promise` so the
TypeScript files can see the monkey-patched methods.

### Error codes over error classes

Errors are usually distinguished by a string `code` property (`'ETIMEOUT'`,
`'ENOTFOUND'`, Node's own `errno` codes) rather than by `instanceof`.
`lib/core/errors.js` defines only a small hierarchy (`AbstractError`,
`OutOfCapacityError`). See `loggingAndErrors.md`.

## The global `logger`

`lib/core/log.js:23` assigns `global.logger = log4js.getLogger('shiny-server')`.
**Every module uses a bare `logger.info(...)` with no import.** Seventeen files
call `logger.*` without requiring anything.

Two consequences worth knowing:

- Any module that touches `logger` at load time depends on `lib/core/log` having
  been required first. `main.js` requires it early, and `.mocharc.json`
  auto-requires it for tests — that's *why* the test config requires it.
- `SHINY_SERVER_VERSION` is a second global, set in `lib/core/version.js`. Both are
  declared in `lib/globals.d.ts` for TypeScript's benefit.

Log level comes from `SHINY_LOG_LEVEL` (`lib/core/log.js:29`), defaulting to
`INFO`.

## `map` — the null-prototype object

`lib/core/map.js` provides the codebase's dictionary type, and it is used
wherever keys come from user input or the filesystem: the config schema, the
scheduler registry, `run-as.js`, `app-config.js`, `render.js`, `server.js`,
`app-worker.ts`. Reach for it instead of `{}` when the keys are not
hardcoded — that is the whole point of it. `coreUtilities.md` covers the
details.

## `underscore`, not lodash

`_` is `underscore` throughout. It is still a real dependency and still used
heavily (`_.each`, `_.extend`, `_.map`, `_.without`). Don't introduce lodash
alongside it, and don't rip out underscore usage in passing — many of the call
sites are load-bearing for the `arguments`-object and array-like handling that
plain ES methods don't do.

## The license header

Every source file in `lib/` opens with a block comment: the filename, a
`Copyright (C) 2009-13 by RStudio, Inc.` line, and the AGPL notice. 45 files
carry it verbatim; only `lib/core/errors.js`, `lib/core/python.ts` /
`python.js`, and the `.d.ts` files lack it.

**New files in `lib/` should carry the header**, copied from a neighbor with the
filename line updated. Note that the header on `lib/worker/app-worker.ts` still
says `app-worker.js` — the convention is copy-paste, and nobody has been strict
about it. The copyright year is left at `2009-13`; don't "helpfully" update it,
since the year range is a legal statement, not a modification timestamp.

## TypeScript: compiled output is committed

This is the trap most likely to bite you.

`.ts` files live *alongside* their compiled `.js` in `lib/`, and **both are
tracked in git**:

| Source | Committed output |
| --- | --- |
| `lib/worker/app-worker.ts` | `lib/worker/app-worker.js` |
| `lib/worker/app-spec.ts` | `lib/worker/app-spec.js` |
| `lib/core/python.ts` | `lib/core/python.js` |

Plus hand-written declaration files for JS modules that TS needs to see:
`lib/core/fsutil.d.ts`, `lib/transport/tcp.d.ts`, `lib/globals.d.ts`.

There is no build step at runtime — `lib/main.js` requires the `.js`. So:

> **After editing any `.ts` file, run `npm run build` and commit the regenerated
> `.js` alongside it.** An edit to a `.ts` file alone changes nothing at
> runtime, and the two files silently diverge.

The compiler config (`tsconfig.json`) is `strict: true` with `module:
commonjs` — output lands next to the source because no `outDir` is set.

### The TS/JS interop style

Inside a `.ts` file you'll see `import` and `require` mixed on purpose
(`lib/worker/app-worker.ts:23-35`): ES-style `import` for modules with real
types (`child_process`, `fs/promises`, `./app-spec`, `../transport/tcp`), and
`var x = require(...)` for the untyped legacy JS modules (`bash`, `paths`,
`permissions`, `map`, the native `posix` addon). This is not sloppiness — it is
how the strict compiler is kept happy without writing declarations for every
legacy module.

Likewise, promises are mixed by design: **native `async`/`await` inside**, but
**`Q.Promise` at the public seam** that JS callers touch. `launchWorker_p` at
`lib/worker/app-worker.ts:123` returns `Q.Promise<AppWorker>` while its body is
`await`-based. Keep that boundary — JS callers expect to call `.fin()` and
`.eat()` on what they get back.

## Native addon require path

The `posix` native module is required by its build path, not by package name:

```js
var posix = require('../../build/Release/posix');
```

That path (`lib/router/router.js:22`, `lib/worker/app-worker.ts:32`, and
elsewhere) means **`node-gyp` must have run before anything works**, and it
means `build/` is a required runtime directory, not just a build artifact. See
`nativePrivileges.md`.

## Things that are *not* conventions here

- **No linter or formatter is configured.** There is no ESLint or Prettier
  config in the repo. Formatting is by hand and by imitation. The TypeScript
  files happen to be Prettier-shaped (double quotes, trailing commas); the JS
  files are not (single quotes, 2-space indent, no trailing commas).
- **No `use strict` pragma** in the legacy JS files.
- **`var`, not `let`/`const`**, in legacy JS. The newer files use `const`. Match
  the file.
