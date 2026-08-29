---
title: Build And Packaging
description: How Shiny Server is compiled, vendored, and shipped — CMake/CPack orchestration, the vendored Node runtime (ext/node, install-node.sh, bin/node and bin/npm shims, .nvmrc), the vendored pandoc binaries, the C++ launcher and node-gyp posix module, .deb/.rpm construction with their postinst/posttrans/prerm scripts, the installed /opt/shiny-server layout, systemd/Upstart/SysV service registration, Jenkins CI, developer setup on Linux vs macOS, and the gotchas that break builds.
---

# Build And Packaging

## The shape of the problem

Shiny Server ships as a **self-contained tree under `/opt/shiny-server`** that
carries its own Node.js runtime, its own pandoc binaries, and a full
`node_modules`. It deliberately depends on almost nothing from the host distro
(`CMakeLists.txt:176` lists only `lsb-release` and `libc6 >= 2.7` for Debian;
`CMakeLists.txt:185` sets *no* RPM requires at all, and
`CMakeLists.txt:157` turns off RPM auto-dependency generation entirely).

The reason is the target audience: sysadmins on long-lived, conservative Linux
boxes (RHEL/CentOS, Ubuntu LTS, SLES) who may have an ancient system Node or
none at all. The price is that the build must *fetch and stage* those runtimes,
and the packaging must stop the distro tooling from mangling bundled binaries.

## Pipeline overview

`packaging/make-package.sh` is the single entry point; everything else is
called from it. The order matters and is non-obvious:

1. Pick the CPack generator (`packaging/make-package.sh:11-17`): `DEB` if
   `/etc/debian_version` exists, `RPM` if `/etc/redhat-release` does. Can be
   overridden by `$1`. Also probes for `cmake3`/`cpack3` (EL7-era naming) at
   `packaging/make-package.sh:25-41`.
2. Puts `bin/` on `PATH` (`packaging/make-package.sh:47`) so that the vendored
   `node` shim wins over any system Node for the rest of the script.
3. `cmake -DCMAKE_INSTALL_PREFIX=/opt ../..` then `make`, out of
   `packaging/build/` (`packaging/make-package.sh:48-51`). **Configure time**
   is when pandoc is downloaded and when `VERSION`/`GIT_VERSION` are written;
   **build time** produces exactly one artifact, the C++ launcher.
4. `./external/node/install-node.sh` — downloads and unpacks the runtime into
   `ext/node/` (`packaging/make-package.sh:56`).
5. `./bin/npm install` (all deps, including dev) → `./bin/npm run build` (tsc)
   → `./bin/npm install --only=production` to strip dev deps back out before
   the package is assembled (`packaging/make-package.sh:59-63`).
6. `cpack -G DEB|RPM` (`packaging/make-package.sh:68`) — *this* is what
   actually copies the tree into the package, which is why steps 4-5 must
   precede it.
7. Re-installs devDependencies afterwards so the workspace is usable for tests
   (`packaging/make-package.sh:71`).

So: CMake compiles almost nothing. It is used as a **staging and packaging
engine**, plus a tiny C++ build.

### What actually gets compiled

- **The launcher** (`src/CMakeLists.txt:1-2`) — `src/launcher.cc` → `bin/shiny-server`,
  written directly back into the source tree because
  `CMAKE_RUNTIME_OUTPUT_DIRECTORY` points at `${CMAKE_CURRENT_SOURCE_DIR}/bin`
  (`CMakeLists.txt:5`). It is gitignored. `src/launcher.h` is generated from
  `src/launcher.h.in` and bakes in `${CMAKE_INSTALL_PREFIX}` — also gitignored.
- **`posix.node`** (`binding.gyp`) — built by node-gyp as a side effect of
  `npm install`, into `build/Release/posix.node`. Nine `lib/` modules require
  it by that literal relative path (e.g. `lib/core/permissions.js:13`), so the
  `build/` directory is shipped verbatim (`CMakeLists.txt:41`) even though it
  is gitignored. This is the one place where a gitignored *build output*
  directory is a required package payload.

### The launcher, and why it exists

`src/launcher.cc` is a ~130-line C++ exec wrapper. It resolves its own real
path (`/proc/<pid>/exe` on Linux, `_NSGetExecutablePath` on macOS —
`src/launcher.cc:70-125`), takes `dirname(dirname(...))` as the install root,
and `execv`s `<root>/ext/node/bin/shiny-server` with `<root>/lib/main.js`
prepended to argv (`src/launcher.cc:45-58`).

Two consequences worth remembering:

- Because the base dir is derived from the *resolved* executable path, the
  `/usr/bin/shiny-server` symlink created by postinst works correctly.
- `ext/node/bin/shiny-server` is a **copy of the node binary under a different
  name** (`external/node/install-node.sh:61`). That is purely so the daemon
  shows up as `shiny-server` in `ps`/`pgrep` — which the Upstart
  `post-start` health check depends on (`config/upstart/shiny-server.conf:16`).

## The vendored Node runtime

`external/node/install-node.sh` reads the desired version from `.nvmrc`
(currently `v24.20.0`, including the leading `v`), maps `uname -s`/`uname -m`
to Node's own platform/arch tuples (`external/node/install-node.sh:24-44`),
downloads `https://nodejs.org/dist/<ver>/node-<ver>-<os>-<arch>.tar.xz` with
`wget`, and untars it into `ext/node/` with `--strip-components=1`
(`external/node/install-node.sh:46-56`).

Notes and invariants:

- **No checksum verification.** Unlike the pandoc step, the Node download is
  trusted on HTTPS alone (deliberate or not, unverified).
- **Idempotence is version-based**: if `ext/node/bin/node --version` already
  equals the `.nvmrc` string, the script exits early
  (`external/node/install-node.sh:10-20`). The comparison only works because
  `.nvmrc` carries the `v` prefix — dropping it would silently cause a
  re-download on every build.
- It **deletes `ext/node/bin/npm`** (`external/node/install-node.sh:62`). npm
  is still present under `ext/node/lib/node_modules/npm`; only the convenience
  symlink is removed. The rationale is not documented in the source.
- The download requires `wget` and `xz`-capable `tar`.

### The `bin/node` / `bin/npm` shims

Both are three-line `sh` scripts that resolve relative to their own directory
(`bin/node:4`, `bin/npm:4`), so they work identically in a source checkout
(`bin/` → `../ext/node`) and in the installed tree (`/opt/shiny-server/bin` →
`/opt/shiny-server/ext/node`). `bin/npm` invokes `npm-cli.js` directly under
the vendored node, bypassing the deleted symlink.

**This is the contract for all project tooling.** `tools/preflight.sh:9` runs
`bin/node tools/check-licenses.js`; CI runs mocha via `./bin/node`
(`Jenkinsfile:108`). Using your own `node`/`npm` from `nvm` or Homebrew is
what causes the classic failure mode: `posix.node` gets compiled against a
different ABI than the runtime that will load it, and the server dies at
startup with a NODE_MODULE_VERSION mismatch. `.nvmrc` exists mostly so
`install-node.sh` has a single source of truth; a developer who `nvm use`s it
gets an ABI-compatible local Node as a bonus, not as the supported path.

## Vendored pandoc

`external/pandoc/CMakeLists.txt` downloads `pandoc` and `pandoc-citeproc`
**1.19.2.1** (`external/pandoc/CMakeLists.txt:3`) from an RStudio S3 build
bucket, verifies SHA1 against hashes hardcoded at
`external/pandoc/CMakeLists.txt:11-12`, gunzips them, and copies them into
`ext/pandoc/` with 0755 (`external/pandoc/CMakeLists.txt:69-72`). Cached
downloads are re-verified and discarded on mismatch
(`external/pandoc/CMakeLists.txt:33-54`).

Why it's here: R Markdown documents rendered by Shiny Server need pandoc, and
the host may not have one. `lib/worker/app-worker.ts:574` passes
`paths.projectFile("ext/pandoc")` to the worker, which
`R/SockJSAdapter.R:30` and `python/SockJSAdapter.py:220-221` turn into the
`RSTUDIO_PANDOC` environment variable for the app process.

Gotchas:

- The download URL is **hardcoded to `linux-64`**
  (`external/pandoc/CMakeLists.txt:49`). On macOS or ARM64 the configure step
  still "succeeds" and drops Linux x86-64 ELF binaries into `ext/pandoc/`.
  They are inert unless something tries to render an Rmd.
- These are ~60 MB static binaries each. They are the reason
  `CPACK_RPM_SPEC_INSTALL_POST` is neutered to `/bin/true`
  (`CMakeLists.txt:154-155`) — rpmbuild's default post-install brp scripts
  strip binaries and would corrupt them.
- The pandoc version is ancient and pinned. Bumping it means updating both the
  version and both SHA1s; the comment at
  `external/pandoc/CMakeLists.txt:6-10` explains the "run it and read the
  error" trick for obtaining new hashes.

## What lands on disk

`CPACK_SET_DESTDIR` is on and the prefix is `/opt` (`CMakeLists.txt:89-90`,
`packaging/make-package.sh:50`), so everything installs under
**`/opt/shiny-server/`**:

- `bin/` — `shiny-server` (the compiled launcher), `node`, `npm`,
  `deploy-example` (`CMakeLists.txt:56-61`; `deploy-example` is generated from
  `bin/deploy-example.in` so the prefix can be substituted).
- `ext/node/`, `ext/pandoc/` — the vendored runtimes.
- `lib/`, `node_modules/`, `build/` — the server itself and its native module.
- `config/` (init scripts + default configs), `samples/`, `R/`, `python/`,
  `templates/`, `assets/`, `scripts/`, `tools/`, and also `test/` and
  `manual.test/` — the install list at `CMakeLists.txt:38-52` is broad, and
  dev/test material genuinely ships in the product.
- Top-level `VERSION`, `GIT_VERSION`, `NOTICE`, `COPYING`, `NEWS`,
  `package.json`, `binding.gyp`, `config.html`, `README.md`
  (`CMakeLists.txt:68-77`).

Outside the prefix, created by the postinst scripts: `/usr/bin/shiny-server`
(symlink), `/etc/shiny-server/shiny-server.conf` (copied from
`config/default.config` only if absent), `/srv/shiny-server` (seeded with
symlinks to the bundled welcome page and sample apps, only if absent),
`/var/log/shiny-server` (chowned to `shiny`), `/var/lib/shiny-server`, and
`/etc/logrotate.d/shiny-server`.

## Versioning

`CMakeLists.txt:14-17` `sed`s the `version` field out of `package.json`,
splits it into major/minor/patch (`CMakeLists.txt:19-24`), and appends
`$BUILD_NUMBER` from the environment — defaulting to `0` when unset
(`CMakeLists.txt:7-11`). So a package version is `1.5.24.0` locally and
`1.5.24.<jenkins build>` in CI. Two files are also written into the build dir:
`VERSION` (that four-part string) and `GIT_VERSION` (`git describe --tags
--dirty`) — `CMakeLists.txt:28-33`. CI uploads `VERSION` next to the package
so downstream tooling can discover the latest build (`Jenkinsfile:61`).

Final filename is lowercased `shiny-server-<version>-<arch>.<ext>`
(`CMakeLists.txt:167-168`), with arch from `dpkg --print-architecture` or
`arch` (`CMakeLists.txt:93-108`).

## Package scripts

All four/five maintainer scripts are `.in` templates run through
`configure_file` so `${CMAKE_INSTALL_PREFIX}` is substituted
(`CMakeLists.txt:134-152`).

**Debian** (`packaging/debian-control/`) attaches postinst, prerm, postrm via
`CPACK_DEBIAN_PACKAGE_CONTROL_EXTRA` (`CMakeLists.txt:141`). `postinst.in`
does user creation (`useradd -r -m shiny`, relying on Debian's
useradd creating the group), directory seeding, logrotate placement, LANG
inference, and service registration.

**RPM** (`packaging/rpm-script/`) is stranger. CMake reads the *rendered*
`posttrans.sh` into a variable (`CMakeLists.txt:146-148`) and then
`postinst.sh.in` ends with a literal `%posttrans` line followed by
`${RPM_POSTTRANS_SCRIPT}` (`packaging/rpm-script/postinst.sh.in:49-51`) —
i.e. it **smuggles an entire extra spec section into the generated spec file
through the `%post` script body**, because CPack has no `%posttrans` support.
The service is started from `%posttrans` rather than `%post` so that on
upgrade it starts *after* the old package's files have been removed. This hack
is fragile against CMake versions: `docker/jenkins/Dockerfile.centos8:27`
explicitly warns to avoid CMake 3.18-3.20 "due to `%posttrans` issue".

Also note `CMakeLists.txt:160-161`: `%define ignore #` plus
`CPACK_RPM_USER_FILELIST "%ignore /opt"` — a workaround so the RPM does not
claim ownership of `/opt` itself.

`packaging/rpm-script/prerm.sh.in` exists but **is not wired up** — CMake never
sets `CPACK_RPM_PRE_UNINSTALL_SCRIPT_FILE` and never configures that template
(only POSTTRANS/POSTINST/POSTRM appear at `CMakeLists.txt:116-118`). It is dead
code. RPM users differ from Debian users here: `packaging/rpm-script/postinst.sh.in:14-19`
explicitly `groupadd`s and sets `-s /bin/sh`.

## Service integration

Three init systems, chosen at install time, and the two package families
choose *differently*:

| | Debian postinst (`postinst.in:74-112`) | RPM posttrans (`posttrans.sh.in:9-47`) |
|---|---|---|
| detection | `cat /proc/1/comm` == `systemd` | `-d /etc/systemd/system` |
| second choice | Upstart, only if distro is Ubuntu/LinuxMint **and** `/etc/init/` exists | Upstart, if `/etc/init/` exists |
| fallback | `config/init.d/debian/shiny-server` | `config/init.d/suse/…` if `/etc/SuSE-release`, else `config/init.d/redhat/…` |

Differences that matter:

- **systemd** (`config/systemd/shiny-server.service`) hardcodes
  `/opt/shiny-server/bin/shiny-server` in `ExecStart`
  (`config/systemd/shiny-server.service:6`) and redirects stdout/stderr to
  `/var/log/shiny-server.log` via a `bash -c` wrapper. It uses no pidfile
  (`Type=simple`, `KillMode=process`). **A non-`/opt` install prefix silently
  breaks the systemd unit** even though every other path is templated.
- **Upstart** (`config/upstart/shiny-server.conf`) raises `nofile` to 1,000,000
  (line 8) — the SysV and systemd paths do not, which is a real behavioral
  difference under load. It passes `--pidfile=/var/run/shiny-server.pid`.
- **SysV**: the RedHat and SuSE scripts start the daemon with `--daemon
  --pidfile=…` and manage the pidfile by hand
  (`config/init.d/redhat/shiny-server:30`). The Debian SysV script is the least
  exercised path: it uses `start-stop-daemon --background` with a bare
  `DAEMON=shiny-server` (no absolute path) and an `[ -x "$DAEMON" ]` guard that
  tests a *relative* path (`config/init.d/debian/shiny-server:21-25`), and it
  passes no pidfile.
- **LANG injection**: both `LANG`-setting branches use line-numbered `sed`
  inserts — `sed -i "11 a Environment=…"` into the unit file
  (`postinst.in:82`) and `sed -i "10 a export LANG=…"` into the init script
  (`postinst.in:105`). Reordering lines in
  `config/systemd/shiny-server.service` or in the Debian init script will put
  the injected line in the wrong section. There is also an apparent bug at
  `packaging/debian-control/postinst.in:103`: the SysV branch greps
  `/etc/init/shiny-server.conf` (the Upstart path) to decide whether to patch
  `/etc/init.d/shiny-server`.
- `config/logrotate` rotates `/var/log/shiny-server.log` — the *daemon's own*
  stdout log, not the per-app logs in `/var/log/shiny-server/`, which Shiny
  Server manages itself.

Uninstall: Debian `prerm.in` stops and deregisters the service, `postrm.in`
removes the symlink, all three init files, and `/var/shiny-server/sockets`.
RPM `postrm.sh.in` does the file removals only when `$1 = 0` (true uninstall,
not upgrade).

## CI

`Jenkinsfile` (open source) and `Jenkinsfile.internal` are near-identical
copies that diverge only in target platforms and publishing:

- Parallel Docker containers built from `docker/jenkins/Dockerfile.<os>`:
  `ubuntu-20.04` + `centos8` public (`Jenkinsfile:80-83`), `ubuntu-18.04` +
  `centos7` internal (`Jenkinsfile.internal:108-111`). x86_64 only — **there is
  no ARM64 CI**, despite `install-node.sh` supporting it and NEWS claiming
  ARM64 source builds work.
- Workspace wiped and `git clean -ffdx`ed every run (`Jenkinsfile:12-16`);
  nothing is incremental. Stages: `make-package-jenkins.sh` → mocha via
  `./bin/node` → `tools/preflight.sh` (license + upstream-merge checks) →
  upload.
- `packaging/make-package-jenkins.sh:9-14` wraps the build in `scl enable
  devtoolset-11` when available, for old EL toolchains. Crucially it then
  fails the build if `git diff --stat` is non-empty
  (`packaging/make-package-jenkins.sh:16-20`) — because **the `tsc` output
  `.js` files are checked in** next to their `.ts` sources, and a build that
  regenerates them differently means someone forgot to commit.
- Public job uploads the package plus `VERSION` to S3 and calls
  `docker/jenkins/publish-build.sh`, which commits a Markdown metadata file to
  `rstudio/latest-builds` (only from `master`). Internal job pushes to
  Cloudsmith instead, with the S3 stage commented out
  (`Jenkinsfile.internal:145-160`).
- `docker/jenkins/publish-build.sh:113-118` infers open-source vs professional
  by testing for `CMakeOverlay.txt` — the same file CMake conditionally
  includes at `CMakeLists.txt:129-131`. That overlay is the Shiny Server Pro
  hook; it is absent from this repo.

## Developer setup

`tools/setup-devenv-debian.sh` / `-redhat.sh` install a compiler toolchain,
git, python, openssl headers, and cmake, then delegate to
`tools/_setup-devenv-common.sh`, which creates the `shiny` user, makes
`/var/log/shiny-server` and `/srv/shiny-server`, runs cmake+make in
`tools/build/`, and finishes with `bin/npm install`
(`tools/_setup-devenv-common.sh:12-28`). Note it does **not** run
`install-node.sh` first, so `bin/npm` only works if `ext/node` already exists —
in practice you run `external/node/install-node.sh` yourself, or just use
`packaging/make-package.sh`. The scripts are stale in details (they install
`python`, i.e. Python 2, and `cmake28`), as are
`external/install-dependencies-*`, which document building CMake 2.8 from
source even though `CMakeLists.txt:1` now requires 3.20.

From-scratch local build, Linux:

`external/node/install-node.sh`, then cmake+make out of a build dir, then
`bin/npm install && bin/npm run build` — or simply
`packaging/make-package.sh`, which does all of it.

**macOS**: partially supported. `install-node.sh` handles `darwin`/`arm64`,
`launcher.cc` has an `__APPLE__` branch, and the native `posix` module and the
test suite build and run — this is what commit 3d31ccf ("Allow building on
macOS") enabled, and NEWS 1.5.23 advertises. What does *not* work: pandoc
vendoring fetches Linux binaries, and `packaging/make-package.sh` cannot
produce a package (no `dpkg`/`rpm`, and the generator autodetect at
`packaging/make-package.sh:11-17` finds neither, so it exits with usage). macOS
is a *development* platform only; releases are Linux-only.

## Docker

- `docker/jenkins/` is real and load-bearing: it is where the CI build images
  come from.
- `docker/ubuntu16.04/` plus `docker/README.md` is a legacy developer image. It
  is stale — Ubuntu 16.04, R from a dead apt line, and it bootstraps by
  downloading a prebuilt `ubuntu-12.04` .deb from S3
  (`docker/ubuntu16.04/Dockerfile:71-75`). Treat as historical.
- The **root `Dockerfile` is untracked** (`??` in `git status` at the time of
  writing) — a scratch 8-line Ubuntu image that installs build deps and clones
  the repo. It is not part of the product and not referenced by anything.

## Gotchas

- **`packaging/build/` is not source.** It is the CMake binary dir, matched by
  the `build/` line in `.gitignore` (confirmed via `git check-ignore`), and any
  copy in a working tree is stale local output. Do not read it to learn how the
  build works; do delete it when a configure-time change (version, pandoc hash,
  install list) seems not to take effect — `CMakeCache.txt` will happily pin the
  old values.
- **Two different `build/` directories.** Root `build/` is node-gyp output and
  is *shipped*; `packaging/build/` is CMake output and is not. Both are
  gitignored by the same rule.
- **Order dependency**: running `cpack` without having run `npm install` and
  `install-node.sh` first produces a package that is missing `node_modules`,
  `ext/node`, and `build/Release/posix.node`, and it will not error — CPack
  installs whatever directories happen to exist.
- **Mixing Node versions** between `npm install` (which builds `posix.node`)
  and runtime is the most common self-inflicted breakage. Always go through
  `bin/npm` / `bin/node`.
- **Checked-in `tsc` output**: edit a `.ts` file, run `npm run build`, and
  commit *both*. CI enforces this.
- The **install prefix is only half-parameterized** — the systemd unit hardcodes
  `/opt/shiny-server`.
- `external/pandoc` runs at *configure* time, so a network outage or an S3
  change breaks `cmake`, not `make`.
- Platform assumptions baked in throughout: Linux, root, `/proc` available
  (both `launcher.cc` and the postinst init-system detection read it), glibc,
  and a distro that is Debian-ish or RedHat/SuSE-ish.
