---
title: Router Chain And AppSpec Resolution
description: How Shiny Server turns an incoming HTTP/SockJS URL into an AppSpec (or handles it outright) — the getAppSpec_p contract, the RestartRouter/LocalConfigRouter/SquashRunAsRouter wrapper stack built in main.js, ConfigRouter's server+location tree, DirectoryRouter/SingleAppRouter/UserDirsRouter matching, URL prefix stripping and trailing-slash redirects, ~user expansion, restart.txt, and how AppSpec.getKey() drives scheduler pooling.
---

# Router Chain And AppSpec Resolution

Everything in `lib/router/` exists to answer one question per request: *which app
is this URL for, and what settings does it run under?* The answer is an
`AppSpec`. This doc covers the contract, the composition, and the couplings that
aren't obvious from any single file.

## The contract

`router.getAppSpec_p(req, res)` returns a Q promise resolving to one of three
things (documented at `lib/router/router.js:44`):

| Value | Meaning to the caller |
| --- | --- |
| `AppSpec` object | Launch/reuse this app and proxy the request to it |
| `true` | The router already wrote a complete response (redirect, static file, 403, directory index). Do nothing more. |
| falsy (`null`) | "Not mine." Try the next router; if none claim it, 404. |

The three-way return exists because routers are not just *lookups* — several of
them (`DirectoryRouter` static serving, trailing-slash redirects, `RedirectRouter`,
the `/ping` handler) legitimately finish the request themselves. Collapsing
`true` and `AppSpec` into one type would require every caller to sniff the shape.

Both consumers implement the same three-way discrimination:

- `lib/proxy/http.js:102-115` — `true` → return silently; falsy → `error404` using
  `req.templateDir`; otherwise proceed.
- `lib/proxy/sockjs.js:77-91` — same, plus a `reconnect` check.

**`res` may be undefined.** For SockJS, `req` is a SockJS *connection* object and
there is no `res` at all (`lib/proxy/sockjs.js:76` calls `getAppSpec_p(conn)` with one
arg). Any router that wants to write a response must tolerate this.
`SingleAppRouter` handles it explicitly (`lib/router/router.js:230-233`, returns
`null` instead of redirecting); `RedirectRouter` bails at `lib/router/router.js:321`.
`DirectoryRouter` does **not** guard — its redirect/static paths would throw on an
undefined `res`. In practice SockJS URLs always contain `/__sockjs__/...` after the
app directory, so those branches aren't reached, but that is an invariant, not a
check.

The SockJS connection is duck-typed to satisfy the routers: sockjs-node's
`decorateConnection` sets `.url`, `.address` (the *local* socket address, which is
exactly what `ServerRouter.getScore` wants) and a whitelisted subset of `.headers`
including `host`. See `node_modules/sockjs/lib/transport.js:147-175`.

## Composition

Built once at startup in `lib/server-init.js`:

```
SquashRunAsRouter                       (lib/router/squash-run-as-router.js)
 └─ LocalConfigRouter                   (lib/router/local-config-router.js)
     └─ RestartRouter                   (lib/router/router.js:87)
         └─ CompositeRouter             (router.join)
             ├─ IndirectRouter ──▶ ConfigRouter   (swapped in on config (re)load)
             └─ ping()                  (lib/server-init.js)
```

The result, `metarouter`, is handed to both `ShinyProxy` (`lib/server-init.js`)
and the SockJS server (`lib/server-init.js`) — one router instance serves both
transports.

`IndirectRouter` exists so config reload can hot-swap the `ConfigRouter`
(`lib/server-init.js`) without rebuilding the wrapper stack or the proxy. It starts
as a `NullRouter`.

**Ordering constraints in this stack are load-bearing:**

1. `RestartRouter` must be *inside* `LocalConfigRouter`. `LocalConfigRouter` caches
   parsed `.shiny_app.conf` keyed on `appSpec.getKey()`, and `getKey()` includes
   `settings.restart`. So touching `restart.txt` changes the key and invalidates
   the cached local config. The historical note at `lib/router/local-config-router.js:19-23`
   says this caching is worth 20-30% on connection open.
2. `SquashRunAsRouter` must be outermost. Inner routers may emit *arrays* of
   `run_as` users containing special placeholders like `:HOME_USER:`;
   `UserDirsRouter` substitutes the URL's username into those placeholders
   (`lib/router/user-dirs-router.js:59-64`). Squashing collapses the array to the
   first plain (non-`/^:.*:$/`) string — see `test/squash-run-as-router.js`.
   Squash too early and the placeholder substitution has nothing to work on.
3. `ConfigRouter` is tried **before** `ping`. A config `location /ping` will shadow
   the built-in health check.

`CompositeRouter` (`lib/router/router.js:167`) accepts bare functions as well as
routers and `_.compact`s falsy entries, so conditional routers can be passed
inline. It delegates to `getFirstAppSpec_p` → `qutil.forEachPromise_p`
(`lib/core/qutil.js:91`), which walks serially and stops at the first truthy
result — including `true`. A rejection from any router rejects the whole chain.

## ConfigRouter: servers → locations

`config_router.createRouter_p` (`lib/router/config-router.js:32`) reads the config
against the `shiny-server-rules.config` schema, runs `checkPermissions` (which
front-loads "you need root for `user_dirs`" style failures at startup rather than
at request time — `lib/router/config-router.js:42-101`), and builds a
`ConfigRouter` holding an array of `ServerRouter`s.

`ConfigRouter` also carries process-wide settings that main.js pulls off it after
load (`socketDir`, `httpAllowCompression`, `httpKeepaliveTimeout`,
`sockjsHeartbeatDelay`, `sockjsDisconnectDelay`, `accessLogSpec`,
`allowAppOverride`) — see `lib/server-init.js`. It is a router *and* a config
holder; that dual role is why reload has to touch several subsystems at once.

### Server selection is scored, not first-match

`ServerRouter.getScore` (`lib/router/config-router.js:292`) mimics nginx's
virtual-host resolution: port must match exactly (else fail), wildcard host = 1
point, exact host = 2, matching `server_name` = 3, no `server_name` = 0, mismatched
`server_name` = fail. Higher scores are supposed to be tried first.

> **Known bug.** The sort at `lib/router/config-router.js:158-160` uses
> `return a.score < b.score` — a *boolean*. Native `Array.prototype.sort` coerces
> `true`→1 and `false`→0 and never sees a negative, so the sort is a complete
> no-op; servers are tried in config-file order regardless of score. This
> regressed in commit `49ce8ac` ("Remove stable package in favor of native stable
> sort"): the old `stable` package tested `comp(a,b) <= 0`, for which a boolean
> predicate happened to work. Verified empirically. The scoring/filtering
> (`score > 0` = eligible) still works; only the *priority ordering* is lost.

`ServerRouter.getAppSpec_p` mutates the request: `req.templateDir = this.$templateDir`
(`lib/router/config-router.js:339`). This is the only way `lib/proxy/http.js:113`
can render a branded 404 page when there is *no* `AppSpec` to read
`settings.templateDir` from.

### Locations: post-order traversal and inheritance

Locations are collected with `serverNode.search('location', false, true)` —
**post-order** (`lib/router/config-router.js:223`), so nested `location` blocks land
earlier in the array and therefore win over their parents. This is the entire
mechanism for nested-location precedence; there is no path-specificity sort.

`deriveLocationPath` (`lib/router/config-router.js:351`) walks up the `location`
ancestor chain joining path segments, so `location /a { location /b { } }` yields
`/a/b`.

The subtle part is the `locPath` vs `rootPath` distinction in `createSiteDir`,
`createUserApps`, and `createRedirect`:

- `locPath` = the path of the `location` node being turned into a router.
- `rootPath` = the path of the location that *declared* the hosting directive.
  Config lookups use `getOne`/`getValues` with `inherit=true` by default
  (`lib/config/config.js:112,133`), so a nested location can inherit `site_dir` from
  an ancestor.

When they differ, the real router is built with `rootPath` as its prefix (so path
resolution stays relative to where `site_dir` was declared) and then wrapped in a
`PrefixFilterRouter` on `locPath` so only URLs under the nested location reach it
(`lib/router/config-router.js:382-386`). `PrefixFilterRouter` (`lib/router/router.js:137`)
is a pure gate — it matches the prefix and delegates, contributing nothing to the
`AppSpec`.

`test/configs/valid.config` + `test/nested-locations.js` pin exactly this: `location /d`
inherits `site_dir /srv/shiny-server` from `/a` but overrides `directory_index`, so
it becomes `PrefixFilterRouter(/a/d) → DirectoryRouter(root=/srv/shiny-server, prefix=/a)`.

`app_dir` is the exception: it **may not be inherited**, enforced by the depth
check at `lib/router/config-router.js:390-392` (`locNode.depth !== node.depth - 1`
throws). `createAppDir` returns a bare `SingleAppRouter` with no
`PrefixFilterRouter`, because `SingleAppRouter` already anchors on `locPath`.

A `location` with no hosting directive and no child locations is a config error;
one with child locations returns `null` and is compacted out
(`lib/router/config-router.js:485-493`).

### Settings assembly

`createLocation` (`lib/router/config-router.js:481`) builds the `settings` object
once, at config-parse time — `gaTrackingId`, `logAsUser`, `templateDir`, then
`configRouterUtil.parseApplication(settings, locNode, true)`.

`parseApplication` (`lib/router/config-router-util.js:50`) is shared between the
global config and per-app `.shiny_app.conf` files; the `provideDefaults` flag is
what distinguishes them. With `provideDefaults=false` (the local-config path) it
emits *only* what the file actually specifies, so the merge in
`AppConfig.addLocalConfig` doesn't clobber globals with defaults.

Two things worth knowing:

- `disable_protocols` expands meta-protocols (`streaming`, `polling`) and then
  conservatively also disables `htmlfile`/`eventsource` whenever their
  `iframe-*` siblings are disabled (`lib/router/config-router-util.js:128-133`). The
  comment explains why: admins who whitelisted transports before SockJS 1.x
  shouldn't silently gain new ones. Side effect: you cannot disable the iframe
  variants while keeping the non-iframe ones.
- `settings.scheduler` always ends up set — `{simple: {maxRequests: 100}}` if no
  `simple_scheduler` directive (`lib/router/config-router-util.js:149-155`). Because
  it's part of `settings`, it's part of `getKey()`.

## The leaf routers

### `SingleAppRouter` (`lib/router/router.js:198`) — `app_dir`

Matches `^prefix(?:(/)|$)`. If the trailing slash is missing and `res` exists,
301-redirects to add it, preserving the query string; the app's `prefix` always
ends in `/` (`lib/router/router.js:206`). Then it reads the app directory to decide
`settings.mode`: `server.R`/`app.R` → `shiny`, any `*.Rmd`/`*.qmd` → `rmd`.

Gotchas:

- **No Python detection.** `app.py` is not checked here, so `app_dir` locations
  cannot host Python Shiny apps. Only `DirectoryRouter` recognizes
  `shiny-python` (`lib/router/directory-router.js:300`).
- If no app is found at all, `settings.mode` is left `undefined` and the `AppSpec`
  is still returned — the failure surfaces later, in the worker. `DirectoryRouter`
  by contrast returns falsy and falls through to static serving.
- The `index.html`-instead-of-`index.Rmd` special case (`lib/router/router.js:277-298`)
  writes the response itself and returns `true`. Note it compares
  `self.$prefix === req.url`, i.e. it only fires on the exact bare app URL with no
  query string.
- Settings are `_.clone`d — **shallow** (`lib/router/router.js:239`). See the
  aliasing hazard under "Gotchas" below.

### `DirectoryRouter` (`lib/router/directory-router.js`) — `site_dir`

The workhorse. Given a URL suffix under the prefix, `extractUnescapedDirs`
(`lib/router/directory-router.js:415`) produces the list of progressively deeper
candidate directories, carrying both the decoded filesystem `path` and the
original escaped `rawPath` so the resulting `AppSpec.prefix` is expressed in the
*URL's* encoding. It refuses `..`, escaped slashes, and whitespace-only segments
by returning `null` (path-traversal defense #1); `getAppSpec_p` separately rejects
any path containing `/.` and anything matching the optional `blacklist` regex with
a 403 (`lib/router/directory-router.js:70-77`).

`$findShinyDir_p` walks the candidates shallowest-first and stops at the first
directory that looks like an app: `server.R`/`app.R` → `shiny`, `*.Rmd`/`*.qmd` →
`rmd`, `app.py` → `shiny-python` (`lib/router/directory-router.js:291-324`). It also
terminates early if a candidate doesn't exist. So `/foo/bar/baz` where `/foo` is an
app resolves to `/foo` with `/bar/baz` handed to the app.

Three outcomes:

1. App found, but the URL stopped exactly at the app dir with no trailing slash →
   301 redirect, return `true` (`lib/router/directory-router.js:92-99`).
2. App found → `AppSpec` with `prefix = urlPrefix + rawPath` and
   `settings.mode` set from the detected type. Settings are **deep**-cloned via a
   JSON round-trip (`lib/router/directory-router.js:127`).
3. No app → `$staticServe_p`, which uses `send` to serve files, 301s directories
   missing a trailing slash, serves `index.html` if present, and otherwise either
   renders the auto-index (if `directory_index on`) or resolves `null` so the
   next router gets a shot. A 404 from `send` resolves `null`, not `true` — that's
   deliberate, it lets a later location handle the URL.

### `UserDirsRouter` (`lib/router/user-dirs-router.js`) — `user_apps` / `user_dirs`

Matches `^prefix/([^/]+)(?=/|$)` to pull the username out of the URL. Note the
config-level path is `/users` or similar; the `~user` form is produced by whatever
URL scheme the admin configures, not by this router — it simply treats the first
segment after the prefix as a username.

It resolves the user with `userDb.lookupUser_p` (null → fall through, not
403), optionally gates on `members_of` group membership via `userDb.getGroupIds_p`,
then constructs a **fresh `DirectoryRouter` per request** rooted at
`~user/ShinyApps` with `~user/ShinyApps/log` as the log dir and a hardcoded
blacklist `/^(\/)?log(\/)?/` so the log directory is never served
(`lib/router/user-dirs-router.js:80-81`).

`run_as` handling encodes the historical split between the two directives
(`lib/router/config-router.js:417-434`): `user_apps` passes no `runas`, so the app
runs as the URL's user; `user_dirs` passes the configured `run_as` list, in which
`:HOME_USER:` placeholders are replaced with the URL's username.

Two dead spots here: the module imports `app-spec` without destructuring
(`lib/router/user-dirs-router.js:17`) and never uses it, and the deep-cloned
`settings` at line 78 is discarded — line 81 passes `this.$settings` instead. The
latter is harmless only because `DirectoryRouter` deep-clones per request anyway.

### `RestartRouter` (`lib/router/router.js:87`)

Stats `$APPDIR/restart.txt` and, if present, writes
`appSpec.settings.restart = mtime.getTime()`. That's the whole mechanism:
because `restart` lives in `settings` and `settings` is JSON-stringified into
`getKey()`, a new mtime yields a new key, which yields a *new scheduler*, which
means a fresh worker process. `touch restart.txt` is a per-app restart. Errors
are logged and swallowed — a stat failure must not break the request.

### `LocalConfigRouter` (`lib/router/local-config-router.js`)

Only active when `allow_app_override` is enabled (`$allowAppOverride`, set from
config at `lib/server-init.js`). Reads `.shiny_app.conf` from the app dir
(`lib/config/app-config.js:92`), parses it with `parseApplication(..., /* no defaults */)`,
and merges. `addLocalConfig` (`lib/config/app-config.js:67`) whitelists the mergeable
keys to `appDefaults`, `scheduler`, `frame_options` — a local config explicitly
**cannot** change `runAs`, `appDir`, `logDir`, or `prefix`.

## `AppSpec` and why `getKey()` matters

`lib/worker/app-spec.ts` (compiled to `lib/worker/app-spec.js` — run `npm run build`
after editing the `.ts`):

- `appDir` — absolute filesystem path to the app.
- `runAs` — `string | string[] | undefined`. It's an array between the leaf router
  and `SquashRunAsRouter`, a single string after.
- `prefix` — the URL prefix owned by this app, **always with a trailing slash**.
- `logDir` — where worker stderr goes.
- `settings` — `AppSettings`: `templateDir`, `restart?`, `mode`, `scheduler`,
  `logAsUser`, `gaTrackingId?`, and the nested `appDefaults` (`initTimeout`,
  `idleTimeout`, `preserveLogs`, `reconnect`, `sanitizeErrors`, `disableProtocols`,
  `bookmarkStateDir`, `logFileMode`, `frameOptions?`, `python?`).

`getKey()` (`lib/worker/app-spec.ts:29`) is a newline-joined concatenation of all
five fields, with `settings` JSON-stringified. It is **the** identity of an app for
pooling purposes: `SchedulerRegistry.getWorker` uses it to find-or-create a
`SimpleScheduler` (`lib/scheduler/scheduler-registry.js:66-77`), and schedulers emit
`vacantSched` with the same key to deregister (`lib/scheduler/scheduler.js:188`).

Consequences to keep in mind when touching routers:

- **Any settings difference forks the worker pool.** Two URLs that resolve to the
  same `appDir` but differ in, say, `idleTimeout` or `gaTrackingId` get separate
  R processes. That is intentional (settings must actually apply), but it means
  gratuitous per-request settings mutation silently multiplies processes.
- **Key stability requires deterministic JSON.** `JSON.stringify` is
  insertion-order dependent. `map.create()` (null-prototype objects) is used
  throughout the config path partly to keep this predictable; if you start
  conditionally adding settings keys in varying order, keys will diverge.
- `getKey()` is computed at *different points* in the chain by different
  consumers, and the appSpec is mutated in between — see below.

## Gotchas and invariants

**`ShinyProxy` strips the prefix, and it must match.** `lib/proxy/http.js:123-131`
asserts `req.url.indexOf(appSpec.prefix) === 0` (logging "Bad router returned
invalid prefix" and 404ing otherwise), then rewrites `req.url` to the remainder.
So a router's `prefix` must be a literal, byte-exact prefix of the *unmodified*
`req.url` — this is why `DirectoryRouter` builds the prefix from `rawPath` (escaped)
rather than the decoded path. SockJS does the same slice at `lib/proxy/sockjs.js:159`.

**Shallow clone in `SingleAppRouter` aliases nested settings.**
`lib/router/router.js:239` does `_.clone(self.$settings)`, so `settings.appDefaults`
is the *same object* as the router's long-lived one. `LocalConfigRouter` →
`AppConfig.addLocalConfig` → `merge` (`lib/config/app-config.js:104`) recurses into
nested objects and assigns into the target, i.e. it writes through into the shared
`appDefaults`. With `allow_app_override` on and an `app_dir` location, a
`.shiny_app.conf` therefore appears to leak into the router's baseline settings
for subsequent requests. `DirectoryRouter` is immune because it deep-clones
(`lib/router/directory-router.js:127`). If you touch either clone, keep the deep one.

**`LocalConfigRouter`'s cache key and the scheduler's key are not the same key.**
`AppConfig.readConfig_p` computes `appSpec.getKey()` *before* the local settings are
merged and *before* `SquashRunAsRouter` collapses `runAs`
(`lib/config/app-config.js:35`). The `vacantSched` eviction hook
(`lib/config/app-config.js:28-30`) receives the scheduler's key, computed *after* both.
They coincide only when no local config was merged and the `runAs` array stringifies
to the squashed value (true for a single-user `run_as`). For an app that actually
has a `.shiny_app.conf`, the cache entry is effectively never evicted — stale local
config persists until `restart.txt` is touched (which changes `settings.restart` and
hence the key) or the server restarts. This is consistent with the observable
"touch restart.txt to pick up config changes" behavior, but it is a coincidence of
key composition rather than an explicit design.

**Routers run on every request, including static assets and SockJS frames.** The
filesystem probing in `DirectoryRouter.$findShinyDir_p` (one `readdir` per candidate
directory) is on the hot path. That's the reason `LocalConfigRouter` caches at all.

**`req` mutation summary.** `ServerRouter` sets `req.templateDir`. `ShinyProxy`
rewrites `req.url` (after routing). `lib/server-init.js` rewrites `req.url` for
`__assets__` requests before the proxy ever sees them. Nothing else in the router
layer mutates `req`.

**Adding a router.** Anchor on `url.parse(req.url).pathname` (never the raw
`req.url` — the query string will break your regex), strip trailing slashes from
your configured prefix at construction time, use a `(?=/|$)` lookahead so `/foobar`
doesn't match a `/foo` prefix, tolerate `res === undefined`, and return `null`
(not `false`, not a rejected promise) for "not mine."
