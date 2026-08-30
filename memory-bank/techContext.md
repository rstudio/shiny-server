---
title: Tech Context
description: The developer-facing stack for Shiny Server — the runtime dependency set and why three of them are pinned GitHub forks (optimist, shiny-server-client, sockjs-client), the npm-shrinkwrap policy, the license-compliance workflow (tools/check-licenses.js, tools/preflight.sh, NOTICE.md), the partial TypeScript adoption and the "commit the compiled .js" rule, the Q promise library and the `_p` convention, Node version pinning via .nvmrc and the vendored ext/node (and why `nan` must move with it), the 2026 dependency sweep that took the stack to Node 24 / Express 5 / TypeScript 6 and what it deliberately left alone, upstream-tracking scripts, the `overrides` that hold `npm audit` at zero and the two `npm outdated` rows that are permanent (q's `future`-tag false positive, @types/node held to the runtime major), and the build/test/run commands (including `npm run dev` and the one-time `uv sync` its Python sample app needs, and what breaks on a macOS dev machine).
---

# Tech Context

This is the "what am I working with" doc. Packaging (CMake, deb/rpm, Jenkins) is
covered separately in `memory-bank/buildAndPackaging.md`; this doc stops at the
developer's edge of that boundary.

## Runtime stack at a glance

- **Node.js**, CommonJS throughout. No bundler, no transpile step for the `.js`
  files — they are the source.
- **A small C++ addon** (`src/posix.cc`, built by node-gyp per `binding.gyp`)
  exposed as `build/Release/posix`. Nine `lib/` modules require it directly
  (`lib/core/fsutil.js:16`, `lib/router/router.js:22`, `lib/worker/run-as.js:22`,
  and others). This is load-bearing for *everything* — you cannot even load the
  test suite without a matching-ABI `posix.node`.
- **Python and R** are not dependencies of the server; they are what the
  workers run. `tools/memlog-view.R` is a small ggplot/Shiny scratch app for
  eyeballing the memory log — a developer utility, not shipped functionality.

## Dependency set, grouped by role

From `package.json` `dependencies`:

| Role | Packages |
| --- | --- |
| HTTP framework / middleware | `express` (v5), `compression`, `morgan`, `client-sessions`, `send`, `mime-types`, `qs`, `pause` |
| Proxying | `http-proxy-3` |
| WebSocket / SockJS | `faye-websocket`, `sockjs` (server), `sockjs-client` (served to browsers), `shiny-server-client` |
| CLI / config | `optimist` (argv parsing), `ip-address` (config validation) |
| Templating / rendering | `handlebars` |
| Promises | `q` |
| Logging | `log4js`, `split` |
| Utility | `underscore`, `moment`, `graceful-fs`, `bash` |
| Native build | `nan` |

Dev: `mocha`, `should`, `sinon`, `rewire`, `typescript`, and `@types/*`.

Notes on the less obvious entries:

- **`http-proxy-3`** is a maintained fork of `node-http-proxy`, whose last
  release was 1.18.1 in May 2020. API-compatible for everything `ShinyProxy`
  uses; the one difference is that it no longer emits `proxySocket`, which only
  ever appeared in the diagnostic `knownEvents` list in `lib/proxy/http.js`.
- **`send`** is on 1.x, which dropped the `send.mime` re-export in favour of
  delegating to `mime-types`. That is why **`mime-types` is a direct
  dependency**: `lib/router/directory-router.js` registers `.R` as `text/R` by
  mutating `require('mime-types').types`, and that only takes effect if our copy
  and send's copy are the same hoisted instance. Declaring it is what guarantees
  that rather than leaving it to hoisting luck.
- **`bash@0.0.1`** is a tiny shell-quoting helper. It has no license field in
  its `package.json`, which is why it is hardcoded in `KNOWN_LICENSES`
  (`tools/check-licenses.js:8`).
- **`overrides`** — three entries, all clearing advisories in trees whose
  parent is already at its latest release, so there is nothing to upgrade *to*:
  `sockjs`'s transitive `uuid` → `^11.1.1`; `mocha`'s `diff` → `^9` and
  `serialize-javascript` → `^7`; and a top-level `picomatch` → `^4`. Read "The
  2026 dependency sweep" and "Keeping `npm audit` at zero" below before touching
  them.

### The three GitHub-pinned forks

These are the gotcha of this dependency set. All three are installed straight
from a git ref, not from the npm registry, which means **`npm outdated` and
`npm audit` will not tell you anything useful about them** and upgrading is a
manual, human-judgment operation.

1. **`optimist` → `github:rstudio/node-optimist#dbbadda`**
   Upstream `optimist@0.6.1` is deprecated and depends on `minimist@~0.0.1`,
   which has known prototype-pollution advisories. Upstream will never publish a
   fix. The Posit fork keeps the version string at `0.6.1` but bumps the
   dependency to `minimist@~1.2.3`. Introduced in `9e15292` (May 2020).
   *Upgrade path:* the real fix is to replace `optimist` with a maintained argv
   parser, since `lib/main.js` uses only a thin slice of its API. Until then,
   leave the pin alone.

2. **`shiny-server-client` → `github:rstudio/shiny-server-client#v1.2.0`**
   This is a *first-party Posit package*, AGPL-3.0-licensed and never published
   to npm. It is dual-purpose: `lib/server-init.js` serves its `dist/` bundle to
   browsers at `__assets__/shiny-server-client.js`, and the server itself
   `require`s four modules out of its `common/` directory
   (`lib/proxy/robust-sockjs.js:20-23`) so that both ends of the
   reconnect/message-buffering protocol share one implementation. Because it is
   AGPL, `tools/check-licenses.js:117` explicitly exempts it from the license
   check — AGPL would otherwise fail the approved-license regex.
   *Upgrade path:* bump the tag here in lockstep with a release of the sibling
   repo; the wire protocol is shared, so mismatches are a real risk.

3. **`sockjs-client` → `github:jcheng5/sockjs-client#v1.5.2.2-jcheng5`**
   A personal fork of `sockjs-client@1.5.2` carrying a workaround for
   `sockjs/sockjs-client` issue #563 (commit `fba9e81`, "Work around bug in
   SockJS upgrade"). Its `dist/` is served to browsers at
   `__assets__/sockjs.js` (`lib/server-init.js`).
   *Upgrade path:* check whether #563 has been fixed upstream before trying to
   move back to the registry version.

The server-side `sockjs` package is the *unforked* registry one; do not confuse
it with `sockjs-client`.

## `npm-shrinkwrap.json`, not `package-lock.json`

The repo has `npm-shrinkwrap.json` (lockfileVersion 3) and no
`package-lock.json`. This is deliberate: `package.json` declares
`"preferGlobal": "true"` and a `bin`, i.e. Shiny Server is a *publishable
package*, and npm only honors a shrinkwrap (not a lockfile) when a package is
installed as a dependency. More practically, `node_modules/` is shipped verbatim
inside the distributed package (`CMakeLists.txt:38-50` installs the whole
directory), so the exact resolved tree is part of the release artifact and needs
to be reproducible.

Implications when you add or change a dependency:

- Edit `package.json`, run `npm install`, and **commit the regenerated
  `npm-shrinkwrap.json` in the same commit**. Never hand-edit it.
- If npm ever produces a `package-lock.json`, delete it — having both is a
  known source of confusion, and only the shrinkwrap is authoritative.
- The shrinkwrap is the only place the resolved commits of the three GitHub
  forks are recorded.
- Because the tree ships, a transitive dependency's license is *your* license
  problem. Run the license check (below).

## License compliance

Shiny Server is AGPLv3 and Posit also ships a commercial derivative (Shiny
Server Pro), so every bundled dependency must be both GPL-compatible and
commercially redistributable.

**`tools/check-licenses.js`** walks every `package.json` under `node_modules/`
(`getPackageJson`, line 58) and checks each declared license against an
allowlist regex at line 77: MIT, BSD variants, ISC, Apache-2.0, WTFPL, Public
Domain, MPL-2.0, zlib, Unlicense, BlueOak-1.0.0, `(MIT OR CC0-1.0)`. Anything
else is printed and the process exits 1 (lines 126-129). Two escape hatches:

- `KNOWN_LICENSES` (line 7) — packages whose maintainers omitted the field but
  whose license is known from other files in the package.
- `OVERRIDE_LICENSES` (line 27) — currently just `argparse@2.0.1`, declared
  Python-2.0 (ambiguous GPL compatibility) but actually BSD-3-Clause. Each entry
  here represents a manual legal determination; add one only with a comment
  explaining the investigation, as the existing entry does.
- The `shiny-server-client@` exemption at line 117 (first-party AGPL).

**`tools/preflight.sh`** is the two-step gate that must be green before a
release: the license check (line 9) and the upstream check (line 12). Note it
invokes `bin/node`, i.e. the vendored Node, not whatever is on your `PATH`.
Run it after any dependency change and before cutting a release. `CLAUDE.md`
states this as a hard requirement.

**`NOTICE.md`** is the human-curated attribution file — a list of bundled
components followed by full license texts. `CMakeLists.txt:63-66` copies it to
`NOTICE` in the installed package, so it is a shipped legal artifact, not
internal docs. **It is currently stale** and nothing automates it: it still
lists `node-http-proxy` under its old name, plus `stable`, `browserify`,
`connect`, and `webkit-devtools-agent`, none of which are dependencies any more;
and it omits `express`, `compression`, `morgan`, `mime-types`, and
`ip-address`. (`http-proxy-3` is now the real name.) Worth fixing before the next release. `check-licenses.js` does
*not* validate `NOTICE.md` against the actual tree.

**`license.json`** is untracked and not referenced by any script in the repo
(it is a `license-checker`-style JSON dump with absolute paths from this
machine). Treat it as a local scratch artifact, not part of the workflow. It is
not in `.gitignore` either, so it will show up in `git status` — do not commit
it.

## TypeScript adoption

Incremental and small. As of now the TypeScript surface is exactly:

- `lib/worker/app-spec.ts` (60 lines) — the `AppSpec` class plus `AppSettings` /
  `AppDefaults` interfaces. This is the central data type, so typing it first
  gives the most leverage.
- `lib/worker/app-worker.ts` (682 lines) — the real conversion; process launch,
  user switching, log capture.
- `lib/core/python.ts` (61 lines) — Python interpreter / virtualenv resolution.

Plus three hand-written declaration files that let TS code call into untyped JS:
`lib/globals.d.ts`, `lib/core/fsutil.d.ts`, `lib/transport/tcp.d.ts`.

`lib/globals.d.ts` is worth knowing about for two reasons: it declares the two
ambient globals the codebase relies on (`SHINY_SERVER_VERSION` and `logger`,
both set as true globals in `lib/main.js` and `lib/core/log.js`), and it
*augments* the `q` module (lines 8-12) to add `eat()` and `done()` to
`Q.Promise` — `eat()` is monkey-patched onto `Q.makePromise.prototype` at
`lib/core/qutil.js:20`.

### tsconfig settings that matter

`tsconfig.json` is short and every line is a decision:

- `"module": "commonjs"` — must match the rest of the codebase.
- `"strict": true` plus explicit `noImplicitAny`, `noImplicitOverride`,
  `noImplicitReturns`, `noImplicitThis`. New `.ts` code is held to a real
  standard even though its neighbors are untyped JS.
- `"include": ["lib/**/*.ts"]` — only `lib/`. Tests and `tools/` are JS.
- **No `outDir`.** This is the key one: `tsc` emits each `.js` *next to* its
  `.ts` source, so `lib/worker/app-spec.ts` produces `lib/worker/app-spec.js`.
- No `target`, so the emit is whatever the installed TypeScript defaults to;
  currently that produces `const`/arrow-friendly output with `__importStar`
  helpers (see the top of `lib/core/python.js`).

### The compiled `.js` files are committed — verified

`git ls-files lib` lists `app-spec.js`, `app-worker.js`, and `python.js`
alongside their `.ts` sources. This is intentional: `lib/main.js` and everything
else `require`s the `.js`, packaging installs `lib/` directly with no build
step, and the deb/rpm build does not run `tsc`.

**Therefore: after editing any `.ts` file you must run `npm run build` and
commit both the `.ts` and the regenerated `.js`.** Forgetting this produces a
build that silently runs stale code. There is no CI check for drift, and no
`.js.map` files are emitted, so a stale `.js` is invisible until it misbehaves.
(Verified at the time of writing: `npm run build` on a clean tree produces no
diff — the committed output is in sync.)

Do not edit the generated `.js` files by hand.

## Promises: Q, and the `_p` convention

The legacy async style is the **Q** promise library (`q@^1.5.1`), with
`lib/core/qutil.js` adding helpers — `eat()` to swallow rejections, and
`serialized()` to force one-at-a-time execution of a promise-returning function.
The naming convention is a `_p` suffix for anything returning a promise:
`getAppSpec_p`, `exists_p`, `resolvePython_p`. It is used consistently and you
should follow it in existing modules.

Two Q-specific facts that bite:

- Q resolves via `process.nextTick`, which is why the Sinon fake-timer setup in
  `test/scheduler.js` uses `toNotFake: ['nextTick', 'queueMicrotask']`. Fake all
  timers naively and Q promises simply never settle.
- `q` is deliberately excluded from dependency upgrades — the 2026 sweep moved
  everything else. Q 2.x is a different library, abandoned since 2015; the pin
  is intentional.

**Direction of travel:** away from Q. `lib/core/python.ts`, the newest module,
is entirely native `async`/`await` and does not use Q at all — its
`import Q = require("q")` on line 4 is vestigial and unused. `app-worker.ts` is
a hybrid: it returns `Q.Promise` at its public boundaries (line 123) for
callers' sake but uses native `Promise` and `async` internally. That is the
pattern to copy: native promises inside, Q only where an existing Q-based caller
requires it.

## Node version policy

- **`.nvmrc` is the single source of truth** — currently `v24.20.0`.
  `external/node/install-node.sh:8` reads it (`NODE_VERSION=$(cat .nvmrc)`),
  downloads the matching official Node tarball for the host OS/arch, and
  extracts it to `ext/node/` (gitignored). `bin/node` and `bin/npm` are two-line
  shims that exec out of `ext/node/`. The vendored Node is what ships in the
  package, which is why Shiny Server has no system Node prerequisite.
- **`engines` in `package.json` says `node >=22.0.0`, `npm >=7.0.0`** — raised
  from `>=18.0.0` (the Express 5 floor) when `http-proxy-3` went to 2.x, which
  declares `node >=22`. It is a floor, not a target: `.nvmrc` is what
  actually runs and what ships.
- Since 1.5.23 the project uses **official Node binaries** again. Between 1.5.21
  and 1.5.22 it built its own for glibc compatibility with RHEL/CentOS 7; that
  requirement went away when CentOS 7 was dropped.
- Recent history: 18.20.4 → 20.17.0 (1.5.23) → 24.20.0.
  Bumping Node = edit `.nvmrc`, update `NEWS`, re-run `install-node.sh`, and
  rebuild the native addon. **Check `nan` at the same time**: 2.20 does not
  compile against Node 24's V8 headers, and a `nan` too old for the Node in
  `.nvmrc` breaks `npm ci` in node-gyp — which then breaks everything that
  loads `build/Release/posix.node`, i.e. essentially everything.
- There is no `.npmrc`. It used to contain only `scripts-prepend-node-path=true`,
  which npm 9 removed (the behavior is now unconditional); the file was deleted
  as inert.

## Upstream tracking

`upstream.txt` lists `repo branch` pairs that must be merged into the current
branch. **It is currently empty** — only comments and an example. The mechanism
exists for the Shiny Server Pro relationship: SSP is a downstream repo that
must stay merged with open-source `shiny-server`, and there `upstream.txt`
would name `https://github.com/rstudio/shiny-server master`.

`tools/check-upstream.sh` reads each non-comment line, `git fetch`es it, and
calls `tools/is-merged.sh FETCH_HEAD HEAD` (line 9). `is-merged.sh` compares
`git merge-base` against the source ref and fails with a
"HEAD is N commit(s) behind" message if the upstream tip is not an ancestor
(lines 10-15). `preflight.sh` runs it, so on this repo the check is a no-op
that passes trivially — that's expected, not a bug.

## Day-to-day commands

```bash
npm install                                  # deps + node-gyp build of posix.node
npm run build                                # tsc; REQUIRED after any .ts edit
npm test                                     # mocha test/  (~200ms; see testingGuide.md)
npx mocha test/scheduler.js                  # single file
tools/preflight.sh                           # licenses + upstream; before release
npm run dev                                  # local dev server, port 3838, no root
tools/test-config.sh testapps                # run the server against a test config
node tools/makedocs.js                       # regenerate config.html from the schema
```

- **`npm run dev`** runs nodemon against `dev/shiny-server.conf`, which uses
  `run_as :PROCESS_USER:` so no root is needed, and serves `dev/apps/`
  (`r-hello`, `py-hello`) on port 3838. **`py-hello` needs a one-time
  `uv sync --project dev/apps/py-hello`.** It is a `uv` project
  (`pyproject.toml` + `uv.lock` + `.python-version`), the config points at it
  with `python .venv/;`, and `dev/.gitignore` ignores `**/.venv/` — correctly,
  since a venv is a platform-specific build artifact. But nothing creates it, so
  on a fresh clone `/py-hello/` 500s. This is deliberately *not* automated: a
  `predev` hook was considered and rejected, as was teaching the server to
  detect a `uv` project and launch via `uv run`. `uv run` silently creates and
  populates the venv when it is missing, which would move dependency resolution
  — network access and arbitrary package execution as the `run_as` user — into
  the request path of a running server. Provisioning stays the operator's job.
- **`tools/test-config.sh`** is the local-run path. It templates
  `test/configs/$NAME.config.in` (substituting `$USER` and `$ROOT`) into
  `/tmp/shiny-server-test/` and launches `bin/shiny-server` against it. Default
  name is `testapps`. This avoids needing root or a system-wide
  `/etc/shiny-server/shiny-server.conf`.
- **`tools/makedocs.js`** generates `config.html` (the configuration reference)
  from `lib/config/schema.js`. Regenerate it whenever you add or change a config
  directive. Caveat: it `require`s `connect/lib/utils`, and `connect` is no
  longer a dependency — **this script is likely broken as written** and will
  need that one import replaced before it runs.
- `manual.test/` holds ad-hoc load-test and protocol scripts (`loadtest.js`,
  `test-proxy.js`, …). Not part of `npm test`; run by hand when needed.
- `.mocharc.json` auto-requires `should`, `./lib/core/log`, and
  `./lib/core/qutil` for every test — that's how the `logger` global and the
  `eat()` promise extension exist inside tests.

### macOS development: what works and what doesn't

Since 1.5.23 the project builds on macOS (commit `3d31ccf`). You can install
deps, compile TypeScript, and run the full test suite locally.

**The gotcha:** the native `posix.node` addon is ABI-locked to the Node major it
was compiled against. If your shell's `node` differs from `.nvmrc`, *every* test
fails at load time with:

```
The module '.../build/Release/posix.node' was compiled against a different
Node.js version using NODE_MODULE_VERSION 137. This version of Node.js
requires NODE_MODULE_VERSION 127.
```

This is a version mismatch, not a broken checkout. Fix it by using the pinned
Node — `nvm use`, or prepend the vendored one:
`PATH="$PWD/ext/node/bin:$PATH" npm test`. (`npm run build` is unaffected; only
things that load `lib/` care.)

What you still cannot do on macOS: exercise the multi-user story. Running apps
as another Unix user requires root and `setuid`/`setgid`; the deb/rpm packaging
and systemd/init integration are Linux-only. A `Dockerfile` (untracked, Ubuntu
base) exists at the repo root for building/testing in a Linux container.

## The 2026 dependency sweep (PR #596) and security posture

The project is in "keep it current and secure" mode rather than feature work.
The large maintenance sweep landed via PR #596, on top of the integration
harness that was built specifically so the Express 4 → 5 move could be
*verified* rather than merely absorbed.

It is **five commits, each verified against a passing suite** rather than one
bundle, so a regression bisects to a specific upgrade:

1. Node 20.17.0 → 24.20.0, plus the `nan` ^2.18 → ^2.28 bump it requires and
   deletion of the inert `.npmrc`. First on purpose: it holds Node constant for
   every later comparison instead of confounding runtime with dependencies.
2. `http-proxy` → `http-proxy-3`.
3. `express` 4 → 5 **and** `send` 0.19 → 1.2 — inseparable, since Express 5
   depends on serve-static 2 / send 1.
4. `typescript` 5 → 6.
5. Everything else (`ip-address` 9 → 10, compression, handlebars, morgan,
   underscore, mocha 11, rewire 9, sinon 22) plus transitive security fixes.

Only three things in `lib/` changed, which is the substantive finding — the
middleware stack needed **no** Express 5 adaptation, because it is all
`app.use` with bare functions (so path-to-regexp 8 never sees a route string)
and used none of the APIs Express 5 removed:

- `router/directory-router.js` — the `send.mime` → `mime-types` change
  described above.
- `proxy/http.js` — the require, and dropping `proxySocket` from `knownEvents`.
- `core/python.ts` — `resolvePython_p` was annotated `Q.Promise<PythonEnv>`
  while implemented `async`. TS 6 rejects that outright, and it was always a
  fiction. Now `Promise<PythonEnv>`, which also made the `q` import dead.

Two things to know before touching this again:

- **`tsconfig.json` pins `"target": "es2022"`.** It never set one, so the emit
  followed the compiler default — and TS 6 moved that default off ES5, silently
  rewriting every committed `.js` (downlevel helpers → native async/await and
  spread). Pinning it stops the next compiler major doing the same unannounced.
  If a TypeScript bump ever produces a huge `lib/*.js` diff again, check this
  first.
- **The only wire-visible behaviour change in the whole sweep** is that `.R`
  files are served as `text/R; charset=utf-8` rather than `charset=UTF-8`.
  Case-insensitive per RFC 7231 §3.1.1.2. Pinned in
  `test/integration/static-files.js` — the harness caught it, which is the
  clearest evidence the harness was worth building.

On the security side the sweep took `npm audit` from 25 findings to 5. It moved
`websocket-driver` 0.7.4 → 0.7.5 (critical, resource-limit bypass via message
compression — reachable here because `faye-websocket` and `sockjs` share the
instance) and `flatted` 3.3.1 → 3.4.4. In both cases the parents already allowed
the fixed version and only the shrinkwrap pin was stale, so `npm update <pkg>`
was enough. The 5 findings it left behind were all dev-only, in mocha's and
nodemon's trees; see "Keeping `npm audit` at zero" below for how those were
cleared afterwards.

- The `sockjs`/`uuid` override exists to clear an advisory that does not
  actually apply (sockjs calls only zero-argument `uuid.v4()`), taken as an
  override rather than upgrading `sockjs-node` to its unreleased 0.4.0-rc.1 —
  that main branch removes `Server.prototype.middleware()`, which
  `lib/server-init.js` calls, and changes `prefix` semantics in a way that would
  silently drop all `__sockjs__` traffic. Do not "just upgrade sockjs."

Deliberately **not** moved, so don't read their absence as an oversight:

- **`q`** — 2.x was abandoned in 2015, and Q is being removed from this codebase
  separately.
- **`typescript` 7** and **`http-proxy-3` 2** — were listed here while #596 was
  open; both have since landed (see below).
- **`@types/node`** — held at 24.x to match the runtime rather than following
  `latest` to 26, which would type against APIs Node 24 does not have.

There is also an in-progress plan at `plans/2026-08-28-Express-unit-tests.md`
(untracked): build an HTTP-level integration harness *before* merging #596, so
the Express 4 → 5 change can be verified rather than merely absorbed. It also
sequences PR #597 (`:PROCESS_USER:` run_as token and a `Path` config type, which
together allow non-root test configs) ahead of both.

## Keeping `npm audit` at zero

As of 2026-08-29 `npm audit` reports **0 vulnerabilities**, and holding that line
required three `overrides` rather than upgrades. The pattern in every case: the
*direct* dev dependency is already at its latest published release, and the
advisory is in a transitive dep it pins below the fix. There is nothing to
upgrade to, so the pin has to be overridden.

| Override | Why |
| --- | --- |
| `mocha` → `diff` `^9`, `serialize-javascript` `^7` | mocha 11.8.0 (latest; 12 is still RC) pins `diff ^7` and `serialize-javascript ^6`. Both overrides are safe because mocha's API surface on them is tiny: `diff.createPatch` in `lib/reporters/base.js`, and `serializeJavascript(opts, {unsafe, ignoreFunction})` in `lib/nodejs/buffered-worker-pool.js` (parallel mode only, which this project does not use). Verified by forcing a string-mismatch assertion and checking the reporter still renders a diff. |
| `picomatch` `^4` (top level) | nodemon 3.1.14 (latest) → chokidar 3 → `anymatch`/`readdirp`, which pin `picomatch ^2`; the last 2.x is the vulnerable one, so the only fix is a major bump. **This one must be top-level.** Scoping it under `nodemon` reaches readdirp's edge but not anymatch's, leaving 2.3.1 hoisted and the advisory open. Nothing else in the tree wants `picomatch`, so a global override is unambiguous. Verified end to end: chokidar still fires `add` events and honours `ignored`, and nodemon still restarts on a file change. |
| `nodemon` → `brace-expansion` `^5.0.9` | nodemon's minimatch 10 floats to a vulnerable 5.0.x. Scoped deliberately: the tree also holds `brace-expansion` 1.1.18 (eslint, via rewire) and 2.1.4 (mocha), both *outside* the advisory range, and a global override would drag them across two majors for no reason. |

`npm audit fix` is not useful here — for the mocha chain it proposes
*downgrading* mocha to 11.3.0, which does not fix anything.

### Two `npm outdated` rows are permanent

`npm outdated` will never be empty, and neither row is actionable:

- **`q` 1.5.1 → "2.0.3"** is a **false positive**. Check the dist-tags:
  `latest` is 1.5.1 and `2.0.3` sits under a `future` tag. npm 11's `outdated`
  reports the highest published semver, not the `latest` tag. q 2.0.3 was
  published in **January 2015**, nearly three years *before* 1.5.1 (October
  2017); it is an abandoned rewrite with different dependencies (`asap`,
  `weak-map`, `pop-iterate`) and a different API. "Upgrading" would be a
  functional downgrade. 1.5.1 is the current release. The real fix is removing Q
  from the codebase, which is tracked separately.
- **`@types/node` 24.x → 26.x** is deliberate; see the list above. It goes away
  when `.nvmrc` moves to Node 26, not before.

One deprecation warning also survives `npm ci` — `glob@10.5.0`, pulled by
mocha 11.8.0. It is a deprecation notice, not an advisory, and glob 11 is not a
drop-in for mocha's usage. Leave it.
