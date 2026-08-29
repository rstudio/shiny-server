---
title: Tech Context
description: The developer-facing stack for Shiny Server — the runtime dependency set and why three of them are pinned GitHub forks (optimist, shiny-server-client, sockjs-client), the npm-shrinkwrap policy, the license-compliance workflow (tools/check-licenses.js, tools/preflight.sh, NOTICE.md), the partial TypeScript adoption and the "commit the compiled .js" rule, the Q promise library and the `_p` convention, Node version pinning via .nvmrc and the vendored ext/node, upstream-tracking scripts, and the build/test/run commands (including what breaks on a macOS dev machine).
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
| HTTP framework / middleware | `express` (v4), `compression`, `morgan`, `client-sessions`, `send`, `qs`, `pause` |
| Proxying | `http-proxy` |
| WebSocket / SockJS | `faye-websocket`, `sockjs` (server), `sockjs-client` (served to browsers), `shiny-server-client` |
| CLI / config | `optimist` (argv parsing), `ip-address` (config validation) |
| Templating / rendering | `handlebars` |
| Promises | `q` |
| Logging | `log4js`, `split` |
| Utility | `underscore`, `moment`, `graceful-fs`, `bash` |
| Native build | `nan` |

Dev: `mocha`, `should`, `sinon`, `rewire`, `typescript`, and `@types/*`.

Notes on the less obvious entries:

- **`http-proxy`** is `node-http-proxy`, which is unmaintained. PR #596 replaces
  it with `http-proxy-3`, an API-compatible maintained fork — see "Pending
  upgrade" below.
- **`send`** is on 0.x, where `lib/router/directory-router.js` registers the
  `text/R` type via `send.mime`. PR #596 moves to `send` 1.x, which drops
  `send.mime` in favour of requiring `mime-types` directly.
- **`bash@0.0.1`** is a tiny shell-quoting helper. It has no license field in
  its `package.json`, which is why it is hardcoded in `KNOWN_LICENSES`
  (`tools/check-licenses.js:8`).
- **`overrides`** — there is no `overrides` block today. PR #596 adds one
  forcing `sockjs`'s transitive `uuid` to `^11.1.1`; see "Pending upgrade"
  below before touching it.

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
`ip-address`. Worth fixing before the next release. `check-licenses.js` does
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
- `q` is deliberately excluded from dependency upgrades; PR #596's sweep is
  literally titled "Upgrade all dependencies to latest (except q)". Q 2.x is a
  different library, abandoned since 2015; the pin is intentional.

**Direction of travel:** away from Q. `lib/core/python.ts`, the newest module,
is entirely native `async`/`await` and does not use Q at all — its
`import Q = require("q")` on line 4 is vestigial and unused. `app-worker.ts` is
a hybrid: it returns `Q.Promise` at its public boundaries (line 123) for
callers' sake but uses native `Promise` and `async` internally. That is the
pattern to copy: native promises inside, Q only where an existing Q-based caller
requires it.

## Node version policy

- **`.nvmrc` is the single source of truth** — currently `v20.17.0`.
  `external/node/install-node.sh:8` reads it (`NODE_VERSION=$(cat .nvmrc)`),
  downloads the matching official Node tarball for the host OS/arch, and
  extracts it to `ext/node/` (gitignored). `bin/node` and `bin/npm` are two-line
  shims that exec out of `ext/node/`. The vendored Node is what ships in the
  package, which is why Shiny Server has no system Node prerequisite.
- **`engines` in `package.json` says `node >=6.6.0`, `npm >=2.8.0`.** This is
  vestigial and wildly out of date — ignore it; it does not reflect what
  actually runs. `.nvmrc` is authoritative.
- Since 1.5.23 the project uses **official Node binaries** again. Between 1.5.21
  and 1.5.22 it built its own for glibc compatibility with RHEL/CentOS 7; that
  requirement went away when CentOS 7 was dropped.
- Recent history: 18.20.4 → 20.17.0 (1.5.23). PR #596 moves to 24.20.0.
  Bumping Node = edit `.nvmrc`, update `NEWS`, re-run `install-node.sh`, and
  rebuild the native addon.
- `.npmrc` contains only `scripts-prepend-node-path=true`, which npm 9 removed
  (the behavior is now unconditional). PR #596 deletes the file.

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
tools/test-config.sh testapps                # run the server against a test config
node tools/makedocs.js                       # regenerate config.html from the schema
```

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

## Pending upgrade (PR #596) and security posture

The project is in "keep it current and secure" mode rather than feature work.
The large maintenance sweep is **not on `master` yet** — it lives in PR #596,
branch `replace-http-proxy-with-http-proxy-3`. Everything above describes
`master`; this is what changes when #596 lands:

- `http-proxy` → `http-proxy-3` (maintained fork).
- All deps to latest except `q`; this pulls Express 4 → 5, `send` 0.x → 1.x, and
  `ip-address` 9 → 10, each with real API changes.
- Node 20.17.0 → 24.20.0; `.npmrc` deleted; `mime-types` promoted to a direct
  dependency; an `overrides` block added for `sockjs`'s `uuid`.
- `engines.node` is *not* updated by #596 and remains a stale `>=6.6.0`, even
  though Express 5 requires ≥18.

On the security side, #596 took `npm audit` from 12 findings to 3. Notably it moved
  `websocket-driver` 0.7.4 → 0.7.5 (CVE-2026-54466, critical — reachable here
  because `faye-websocket` and `sockjs` share the instance). The 3 remaining
  findings are all dev-only, inside mocha's tree, and only "fixable" by
  downgrading mocha; they are knowingly left alone.
- The `sockjs`/`uuid` override exists to clear an advisory that does not
  actually apply (sockjs calls only zero-argument `uuid.v4()`), taken as an
  override rather than upgrading `sockjs-node` to its unreleased 0.4.0-rc.1 —
  that main branch removes `Server.prototype.middleware()`, which `lib/main.js`
  calls, and changes `prefix` semantics in a way that would silently drop all
  `__sockjs__` traffic. Do not "just upgrade sockjs."

There is also an in-progress plan at `plans/2026-08-28-Express-unit-tests.md`
(untracked): build an HTTP-level integration harness *before* merging #596, so
the Express 4 → 5 change can be verified rather than merely absorbed. It also
sequences PR #597 (`:PROCESS_USER:` run_as token and a `Path` config type, which
together allow non-root test configs) ahead of both.
