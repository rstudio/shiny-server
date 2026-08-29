---
title: Config System
description: Shiny Server's bespoke nginx-like configuration language — lexer, parser, schema validator (config/shiny-server-rules.config), the runtime ConfigNode tree, directive inheritance/scoping rules, per-app .shiny_app.conf overlays via app-config.js, error reporting, and how to add a new directive end to end.
---

# Config System

Shiny Server does not use JSON/YAML/INI. It ships a small nginx-flavored config
language with its own lexer, parser, and *self-hosted* schema — the schema is
itself written in the config language. Everything lives in `lib/config/`, plus
`config/shiny-server-rules.config` (the schema) and `lib/router/config-router.js`
+ `lib/router/config-router-util.js` (the consumers).

## 1. The language

Two syntactic forms, both nginx-like:

```
directive arg1 arg2;          # simple directive, terminated by ;
directive arg { ... }         # block directive, opens a nested scope
```

A real config (`config/default.config`):

```
run_as shiny;

server {
  listen 3838;

  location / {
    site_dir /srv/shiny-server;
    log_dir /var/log/shiny-server;
    directory_index on;
  }
}
```

Lexical facts worth internalizing (`lib/config/lexer.js`):

- **Newlines are just whitespace.** The *only* statement terminators are `;`,
  `{`, and `}` (`lib/config/parser.js:106`). See the gotcha in §7 — this is the
  single most common source of confusing config errors.
- Character classification is a whitelist regex (`lib/config/lexer.js:297`).
  Anything not alpha/digit/brace/`;`/`#`/quote/backslash/whitespace/control falls
  into `C_OTHER`, which is a *word* character. That is why `/srv/a-b_c.d:1` and
  `http://x` lex as a single `TT_WORD` with no quoting needed.
- Quoting: `'...'` and `"..."` both work; the *other* quote type is literal
  inside; `\` escapes the next character (`lib/config/lexer.js:205`). Outside
  quotes a backslash is an ordinary word character — **there is no unquoted
  escaping** (`lib/config/lexer.js:183`).
- `#` starts a comment to end of line.
- Empty statements (`;;;`) and a stray `;` after a block (`server { ... };`) are
  both silently tolerated.

## 2. The pipeline

`text → Token[] → Directive tree → ConfigNode tree → schema-validated ConfigNode tree`

| Stage | Entry point | Output type |
|---|---|---|
| Lex | `lib/config/lexer.js:101` `nextToken()` | `Token{type, content, position}` |
| Parse | `lib/config/parser.js:46` `parse()` | `Directive{nameToken, args, children}` |
| Lift | `lib/config/config.js:58` `directiveToConfig()` | `ConfigNode` (adds `parent`, `depth`) |
| Validate | `lib/config/schema.js:20` `applySchema()` | same tree, `node.values` populated |

`lib/config/config.js:29` `read_p(path, schemaPath)` is the whole thing wrapped in
Q; `readSync` (`lib/config/config.js:46`) is the sync twin, used only by tooling.

**Key design point:** the lexer/parser are entirely schema-agnostic. They know
nothing about `server` or `location`. All semantics come from
`config/shiny-server-rules.config` at the validate stage.

`ConfigNode` (`lib/config/config.js:93`) is the runtime shape:

```js
{ parent, name, args /* string[] */, values /* null until applySchema */,
  position, depth, children }
```

`args` is always the raw strings; `values` is the schema-typed, defaulted,
named-parameter map. A tree dump of `test/configs/valid.config` after
`applySchema`:

```
<root>                        args=[]      values=null   depth=0
  run_as                      args=["shiny"]      values={"users":["shiny"]}   depth=1
  server                      args=[]             values={}                    depth=1
    listen                    args=["3838"]       values={"port":3838,"host":"*"}  depth=2
    location                  args=["/a"]         values={"path":"/a"}         depth=2
      site_dir  log_dir  directory_index  app_idle_timeout ...                 depth=3
      location                args=["/b"]         values={"path":"/b"}         depth=3
```

Note the root node has `name === null` and `values === null` — it is never
schema-validated (`applySchema` uses `configRoot.search(true, false)`, excluding
self, `lib/config/schema.js:26`).

The `map.create()` helper (`lib/core/map.js:20`) returns `Object.create(null)`;
`values` and all schema-side lookup tables use it so that directive names like
`constructor` or `__proto__` can't collide with `Object.prototype`.

## 3. The schema

`config/shiny-server-rules.config` is misnamed if you expect "rules for apps" —
it is *the directive schema for the whole product*, parsed with the same parser.
Each top-level block declares one directive. From
`config/shiny-server-rules.config:1`:

```
run_as {
  desc "The user the app should be run as. ...";
  param String users... "The username that should be used to run the app. ...";
  at $ server location;
  maxcount 1;
}
```

Declaration fields, read by `ConfigSchemaRule` (`lib/config/schema.js:36`):

- **`at <parent>...`** (required) — legal parent scope names. `$` means the file
  root and is mapped to `null` to match the root `ConfigNode`'s name
  (`lib/config/schema.js:42`). Missing `at` → "Bad schema" error.
- **`param <Type> <name> "<desc>" [default]`** — positional parameters, repeated.
  Name syntax encodes arity (`lib/config/schema.js:167`):
  - `name` → required
  - `[name]` → optional; a 4th arg to `param` supplies the default
  - `names...` → vararg; collects the remainder into an array
  Order is enforced: required, then optional, then at most one vararg
  (`lib/config/schema.js:63`). Defaults are only legal on optional params, never
  varargs.
- **`maxcount <n>`** — how many times this directive may appear *in one scope*
  (siblings only, not descendants). Default is `Infinity`.
- **`precludes <name>...`** — mutually-exclusive siblings.
- **`desc "..."`** — documentation only, consumed by `tools/makedocs.js`.
- **`undocumented`** — omit from generated docs (`tools/makedocs.js:88`).
- **`internal true`** — present on `google_analytics_id`
  (`config/shiny-server-rules.config:134`) but **read by nothing**. It is a no-op;
  `google_analytics_id` is in fact documented.

Types are `Boolean`, `Integer`, `Float`, `String` (`lib/config/schema.js:194`).
`Boolean` accepts `true|yes|on` / `false|no|off`, case-insensitive. `Integer`
accepts hex `0x…`.

Validation order per node (`lib/config/schema.js:86`): location → args/types →
maxcount → precludes.

### Adding a directive end to end

1. Add a block to `config/shiny-server-rules.config` (`desc`, `param`s, `at`,
   usually `maxcount 1`).
2. Consume it. Server-global settings are read in the `ConfigRouter` constructor
   (`lib/router/config-router.js:103`); per-location app settings belong in
   `parseApplication` (`lib/router/config-router-util.js:50`) via
   `locNode.getValues('my_directive').myParam`.
3. If it becomes part of `AppSpec.settings`, add the field to `AppSettings` /
   `AppDefaults` in `lib/worker/app-spec.ts` and run `npm run build`. Anything
   landing in `settings.appDefaults` is automatically per-app overridable (§5).
4. Regenerate the reference doc: `node tools/makedocs.js` → `config.html`
   (see §6 — currently broken).
5. If nesting/inheritance behavior is interesting, add a fixture under
   `test/configs/` and a case in `test/nested-locations.js`.

## 4. Inheritance and scoping

**Inheritance is not declared in the schema; it is a property of the lookup.**
`ConfigNode.getOne(criteria, inherit)` defaults `inherit` to `true`
(`lib/config/config.js:112`): it searches this node's direct children, and on
miss recurses to `parent`. `getValues` and `getValue` wrap it
(`lib/config/config.js:133`, `:164`). So a directive is effectively inheritable
iff (a) its `at` list permits it at an ancestor scope, and (b) the consuming code
doesn't pass `inherit: false`.

Consequences:

- **Nearest scope wins.** A `location`'s own `app_idle_timeout` shadows the one
  in its parent `location`, which shadows `server`, which shadows top-level.
  `test/configs/valid.config` exercises exactly this: `/a/b` gets `5`, `/a/c`
  inherits `30` (`test/nested-locations.js:56`).
- **There is no merging or accumulation.** For a vararg directive like
  `disable_protocols` or `members_of`, the nearest declaration wins wholesale;
  ancestor values are not appended. `getAll` (`lib/config/config.js:148`) is
  deliberately non-inheriting.
- **`precludes` is checked within a single scope only** (`node.parent.getOne(p,
  false)`, `lib/config/schema.js:152`). Top-level `run_as` plus a `location` with
  `user_apps` does not trip the `user_apps precludes run_as` rule.
- **`maxcount` is likewise per-scope.** Two `server` blocks each with one
  `listen` is fine; two `listen` in one `server` is not.
- The rendered doc's "Inheritable: yes/no" row is a *heuristic*:
  `templates/config.html:41` prints yes whenever `at` has more than one entry
  (`tools/makedocs.js:91`). It is not derived from actual call sites.

Some rules that inheritance alone can't express are hand-coded in the router:

- A nested `location` **may not inherit `app_dir`** — enforced by a `depth`
  comparison at `lib/router/config-router.js:390`. Fixture: `test/configs/bad1.config`.
- A leaf `location` must resolve (possibly by inheritance) to exactly one hosting
  model directive — `lib/router/config-router.js:490`. Fixture:
  `test/configs/bad2.config`.
- Nested `location` prefixes are concatenated by `deriveLocationPath`
  (`lib/router/config-router.js:351`), and locations are collected in **post-order**
  so children out-rank parents when matching (`lib/router/config-router.js:223`).

## 5. Per-app overlays: `.shiny_app.conf`

Confusingly, the *same* file — `config/shiny-server-rules.config` — is used as the
schema for per-app config files (`lib/config/app-config.js:47`). The per-app file
is named `.shiny_app.conf` and lives in the app directory
(`lib/config/app-config.js:93`).

Because the schema is shared, a `.shiny_app.conf` is validated as if its root were
`$`: any directive whose `at` list contains `$` parses successfully there,
including `run_as` and `server`. **Parsing success does not imply effect.** Two
independent filters make the overlay safe:

1. `parseApplication` (`lib/router/config-router-util.js:50`) is called on the
   overlay root with `provideDefaults` falsy
   (`lib/router/local-config-router.js:40`). It only ever reads a fixed list of
   directive names off the root node's *direct children*, so anything nested
   inside a `server{}`/`location{}` block in an overlay is simply invisible, and
   `run_as` is never read.
2. `addLocalConfig` (`lib/config/app-config.js:67`) whitelists the resulting
   settings to `appDefaults`, `scheduler`, `frame_options` before a recursive
   `merge` into `AppSpec.settings` (`lib/config/app-config.js:74`). This is what
   stops an app author from escalating to another `runAs`, relocating `logDir`,
   etc. (`test/app-config.js:97` asserts `logDir` is dropped.)

   `'frame_options'` in that whitelist is **dead**: `parseApplication` emits
   `settings.appDefaults.frameOptions`, never a top-level `frame_options` key.
   Frame options *are* overridable per-app, but via `appDefaults`.

The whole mechanism is gated on the top-level `allow_app_override` directive
(default `true`), plumbed through `ConfigRouter.getAppOverride()` →
`LocalConfigRouter.setAppOverride()` (`lib/main.js:253`).

Overlays are cached per `AppSpec.getKey()` and evicted on the `vacantSched` event
(`lib/config/app-config.js:28`) — the cache must live *outside* the `RestartRouter`
because the key includes the restart timestamp; see the historical note at
`lib/router/local-config-router.js:19`. The cache stores the "no overlay found"
result too, so a missing file costs one stat per app lifetime.

## 6. Generated documentation

`tools/makedocs.js` reads `config/shiny-server-rules.config` with
`config.parse` (no schema application — it works off `.args`, since `.values` is
null), reuses `schema.ConfigSchemaParam` to decode param arity, and renders
`templates/config.html` (Handlebars) to `config.html` at the repo root.
`desc` strings support a mini-markdown: `` `name` `` auto-links to another
directive's anchor, and `[text](url)` becomes a link (`tools/makedocs.js:33`).

Two caveats:

- **`tools/makedocs.js` does not currently run.** It does
  `require('connect/lib/utils')` at `tools/makedocs.js:26`, and `connect` is not
  in `package.json` and not installed. It is also not wired into any npm script.
- **`config.html` is stale** relative to the schema. E.g. the `log_dir` description
  in the schema mentions `SHINY_LOG_STDERR` (v1.5.13+); the checked-in
  `config.html` does not.

## 7. Error reporting

Every error path funnels position information into the message string:

- Lexer errors attach `err.position` (`lib/config/lexer.js:171`); `ConfigParser.parse`
  appends `position.toString()` to `err.message` (`lib/config/parser.js:53`).
- `Position.toString()` renders `file:line:col` when a `pathHint` was supplied,
  else `at line N, column M` (`lib/config/lexer.js:57`).
- Schema and router errors go through `schema.throwForNode(node, err)`
  (`lib/config/schema.js:225`), which appends `node.position`. `config-router.js`
  imports it for its own semantic errors (permissions, missing `listen`, bad IP,
  duplicate host:port, invalid `frame_options`).

Representative messages (verified):

```
Unknown directive "bogus" (x.conf:1:1)
The listen directive can't be used here (x.conf:1:1)
listen directive appears too many times (x.conf:1:21)
app_dir and site_dir directives are mutually exclusive (x.conf:1:10)
Unterminated directive; did you leave off a semicolon? (x.conf:1:1)
Unexpected } character (did you leave a semicolon off the previous directive?) (x.conf:1:8)
```

**Gap:** type-coercion failures are thrown from `param.convert` inside
`$validateAndTransformArgs` and are *not* wrapped by `throwForNode`, so they carry
no position: `listen abc;` yields bare `"abc" is not a valid Integer value`.

At startup, `lib/main.js:277` logs `Error loading config: <message>` and
`process.exit(1)`. On `SIGHUP` reload (`lib/main.js:324`) a config error is
logged and **eaten** — the previously loaded router stays live, so a bad edit
can't take down a running server.

## 8. Gotchas and invariants

- **Missing semicolons silently swallow the next directive.** Comments do not
  terminate statements — the parser filters `TT_COMMENT` and `TT_WS` out of the
  stream uniformly (`lib/config/parser.js:136`). So

  ```
  run_as shiny    # oops, no semicolon
  server { ... }
  ```

  parses as `run_as shiny server { ... }`, i.e. a `run_as` with a block. Verified:
  `parse('foo #comment\nbar;')` → one directive `foo` with arg `bar`.

- **`Float` is not properly anchored.** `/^(\d*\.\d+)|(\d+\.?\d*)$/`
  (`lib/config/schema.js:219`) is `(^A)|(B$)`, not `^(A|B)$`. Verified:
  `Float('1.5abc') === 1.5` and `Float('abc5') === NaN`. `Integer` and `Boolean`
  are anchored correctly.

- **A `.shiny_app.conf` resets `logFileMode` and `scheduler` even if it doesn't
  mention them.** `parseApplication` sets `appSettings.logFileMode = "640"`
  unconditionally (`lib/router/config-router-util.js:79`) and always assigns
  `settings.scheduler` (`lib/router/config-router-util.js:149`), so both land in
  the whitelist and clobber the server-level values. Verified: an overlay
  containing only `app_idle_timeout 99;` produces
  `{appDefaults:{idleTimeout:99, logFileMode:"640"}, scheduler:{simple:{maxRequests:100}}}`.

- **The schema file is never validated against a meta-schema.** A typo like
  `maxcont 1;` in `config/shiny-server-rules.config` is silently ignored; only
  a missing `at`, a bad type name, or malformed `param` ordering is caught
  (`lib/config/schema.js:36`).

- `maxcount` is read with `getValue`, which returns a **string**
  (`lib/config/schema.js:48`); `$maxcount` is `"1"`, and the comparisons work only
  through JS numeric coercion. Harmless today, but don't build on it. Note also
  that `getValue`/`getAll` in `ConfigSchemaRule` use inheriting lookups against
  the schema root; this is safe only because no schema block is *named* `maxcount`
  or `param`.

- `lib/config/lexer.js:81` does `data.replace(/\r/, '')` — **no `g` flag**, so only
  the first CR in the file is stripped. It doesn't bite in practice because `\r`
  is classified as whitespace (`C_WS`), but a CRLF file will have slightly odd
  column numbers in errors.

- Directive names are **globally scoped**: `rules` in `applySchema` is a flat
  name→rule map (`lib/config/schema.js:21`). The same name cannot mean two things
  in two scopes; `at` only restricts where it may appear.

- `application` and `user_apps` are deprecated. `application` is not merely
  ignored — `ConfigRouter` logs an error and `process.exit(1)` if any
  `application` node exists (`lib/router/config-router.js:131`), despite several
  directives still listing `application` in their `at` clause.

- `checkPermissions` (`lib/router/config-router.js:42`) runs before the
  `ConfigRouter` is built and rejects configs the current UID can't honor
  (`run_as` to an unreachable user, `user_apps`/`user_dirs` without root, ports
  < 1024 without root). `test/nested-locations.js:25` rewires it out so tests can
  run unprivileged — remember this when adding startup validation there.

- `tools/test-config.sh` templates `test/configs/*.config.in` (substituting
  `$USER` and `$ROOT`) into `/tmp/shiny-server-test/` and launches
  `bin/shiny-server` against it. Useful for exercising a real config without
  touching `/etc/shiny-server/shiny-server.conf` (the default path,
  `lib/main.js:102`).
