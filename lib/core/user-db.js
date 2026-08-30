/*
 * user-db.js
 *
 * Copyright (C) 2026 by Posit Software, PBC
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

// User, group, and group-membership lookups, backed by platform account
// commands rather than a native addon.
//
// The commands used here (`getent`, `id`, `dscacheutil`) go through the
// host's account directory -- NSS on Linux, Directory Service on macOS -- so
// LDAP/SSSD/centrally managed accounts resolve exactly as local ones do.
// Deliberately NOT done: parsing /etc/passwd or /etc/group directly, which
// would bypass that directory.
//
// Every command is invoked with an argument array (never a shell string) and
// resolved from fixed system locations, never from the PATH of whatever
// (possibly root) process launched us.

var child_process = require('child_process');
var fs = require('fs');
var os = require('os');

// Rewireable for tests.
var platform = process.platform;

// Lookup results are cached briefly because user_dirs performs them on the
// request path; spawning one or two processes per page asset would be a
// regression. The positive TTL bounds the access-control revocation delay to
// five seconds, comparable to the caching NSS/Directory Service already do.
var POSITIVE_TTL_MS = 5000;
var NEGATIVE_TTL_MS = 1000;
var MAX_CACHE_ENTRIES = 1024;

// Defensive timeout for account commands; they are local lookups and should
// answer in milliseconds, so a longer runtime means a broken helper or a
// wedged directory service.
var COMMAND_TIMEOUT_MS = 10000;

// Per-platform command table. `notFoundStatus` is the exit status that means
// a clean "no such record" for a keyed lookup; only that status is translated
// to null. `emptyMeansNull` covers dscacheutil, which exits 0 with empty
// stdout for a missing record.
var COMMANDS = {
  linux: {
    searchPath: ['/usr/bin', '/bin'],
    user: {
      command: 'getent',
      args: function(name) { return ['--', 'passwd', name]; },
      notFoundStatus: 2,
      parse: parseLinuxPasswd
    },
    group: {
      command: 'getent',
      args: function(name) { return ['--', 'group', name]; },
      notFoundStatus: 2,
      parse: parseGroupEntry
    },
    groupIds: {
      command: 'id',
      args: function(name) { return ['-G', '--', name]; },
      notFoundStatus: 1,
      parse: parseGroupIds
    }
  },
  darwin: {
    searchPath: ['/usr/bin'],
    user: {
      command: 'id',
      args: function(name) { return ['-P', '--', name]; },
      notFoundStatus: 1,
      parse: parseDarwinPasswd
    },
    group: {
      command: 'dscacheutil',
      args: function(name) { return ['-q', 'group', '-a', 'name', name]; },
      notFoundStatus: null,
      emptyMeansNull: true,
      parse: parseDscacheutilGroup
    },
    groupIds: {
      command: 'id',
      args: function(name) { return ['-G', '--', name]; },
      notFoundStatus: 1,
      parse: parseGroupIds
    }
  }
};

var userCache = new Map();
var groupIdsCache = new Map();
var userInflight = new Map();
var groupIdsInflight = new Map();

/**
 * The current effective user, as {name, uid, gid, home}.
 */
exports.getCurrentUser = getCurrentUser;
function getCurrentUser() {
  var info = os.userInfo();
  return {
    name: info.username,
    uid: info.uid,
    gid: info.gid,
    home: info.homedir
  };
}

/**
 * Resolves {name, uid, gid, home} for `name`, or null if there is no such
 * user. Operational failures (missing utility, unexpected exit status,
 * malformed output) reject.
 */
exports.lookupUser_p = lookupUser_p;
function lookupUser_p(name) {
  // Fast path: the normal non-root development and test path only ever looks
  // up the current effective user, and that needs no external command.
  try {
    var current = getCurrentUser();
    if (name === current.name)
      return Promise.resolve(current);
  } catch (err) {
    // os.userInfo() failed; fall through to the account command.
  }

  return cached_p(userCache, userInflight, name, function() {
    return run_p(platformConfig().user, name, 'look up user "' + name + '"');
  });
}

/**
 * Synchronously returns {name, gid} for `name`, or null if there is no such
 * group. Synchronous because configuration construction is synchronous, and
 * this lookup occurs only for configured `members_of` groups at
 * startup/reload.
 */
exports.lookupGroup = lookupGroup;
function lookupGroup(name) {
  return runSync(platformConfig().group, name, 'look up group "' + name + '"');
}

/**
 * Resolves an array of the numeric group IDs `name` belongs to (primary
 * first), or null if the user no longer exists.
 */
exports.getGroupIds_p = getGroupIds_p;
function getGroupIds_p(name) {
  return cached_p(groupIdsCache, groupIdsInflight, name, function() {
    return run_p(platformConfig().groupIds, name,
      'list groups for user "' + name + '"');
  });
}

function platformConfig() {
  var config = COMMANDS[platform];
  if (!config) {
    throw new Error(
      'Account lookup is not supported on platform "' + platform + '" ' +
      '(supported: linux, darwin).');
  }
  return config;
}

function commandEnv() {
  // LC_ALL=C keeps diagnostics and parseable output stable regardless of the
  // server process's locale.
  var env = Object.assign({}, process.env);
  env.LC_ALL = 'C';
  return env;
}

function resolveCommand(config, spec, operation) {
  for (var i = 0; i < config.searchPath.length; i++) {
    var candidate = config.searchPath[i] + '/' + spec.command;
    if (fs.existsSync(candidate))
      return candidate;
  }
  throw new Error(
    'Cannot ' + operation + ': the "' + spec.command + '" utility was not ' +
    'found in ' + config.searchPath.join(' or ') + ' (platform: ' + platform +
    '). Install it or add it to one of those locations; falling back to ' +
    'parsing /etc/passwd or /etc/group would bypass the host account ' +
    'directory.');
}

function run_p(spec, name, operation) {
  var config = platformConfig();
  var commandPath = resolveCommand(config, spec, operation);
  return new Promise(function(resolve, reject) {
    child_process.execFile(commandPath, spec.args(name), {
      env: commandEnv(),
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS
    }, function(err, stdout, stderr) {
      if (err) {
        if (typeof err.code === 'number' && err.code === spec.notFoundStatus) {
          resolve(null);
          return;
        }
        reject(commandError(operation, commandPath, err, stderr));
        return;
      }
      handleOutput(spec, stdout, operation, resolve, reject);
    });
  });
}

function runSync(spec, name, operation) {
  var config = platformConfig();
  var commandPath = resolveCommand(config, spec, operation);
  var stdout;
  try {
    stdout = child_process.execFileSync(commandPath, spec.args(name), {
      env: commandEnv(),
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    if (typeof err.status === 'number' && err.status === spec.notFoundStatus)
      return null;
    throw commandError(operation, commandPath, err,
      err.stderr && err.stderr.toString());
  }
  var result = {value: undefined, failed: null};
  handleOutput(spec, stdout, operation, function(value) {
    result.value = value;
  }, function(err) {
    result.failed = err;
  });
  if (result.failed)
    throw result.failed;
  return result.value;
}

function handleOutput(spec, stdout, operation, resolve, reject) {
  if (spec.emptyMeansNull && stdout.trim() === '') {
    resolve(null);
    return;
  }
  var parsed;
  try {
    parsed = spec.parse(stdout);
  } catch (err) {
    reject(new Error(
      'Cannot ' + operation + ': malformed output from "' + spec.command +
      '": ' + err.message));
    return;
  }
  resolve(parsed);
}

function commandError(operation, commandPath, err, stderr) {
  var detail;
  if (err.code === 'ENOENT') {
    detail = 'the command could not be started (' + err.message + ')';
  } else if (err.killed) {
    detail = 'the command did not finish within ' + COMMAND_TIMEOUT_MS + 'ms';
  } else if (typeof err.code === 'number' || typeof err.status === 'number') {
    detail = 'the command exited with status ' +
      (typeof err.code === 'number' ? err.code : err.status) +
      (stderr && stderr.trim() ? ': ' + stderr.trim() : '');
  } else {
    detail = err.message;
  }
  return new Error('Cannot ' + operation + ': ' + commandPath + ' failed -- ' +
    detail);
}

// --- Parsing ------------------------------------------------------------

function parseId(field, what) {
  if (!/^\d+$/.test(field))
    throw new Error('expected a nonnegative integer for ' + what + ', got ' +
      JSON.stringify(field));
  var value = Number(field);
  if (!Number.isSafeInteger(value))
    throw new Error(what + ' is out of range: ' + field);
  return value;
}

// getent -- passwd: name:passwd:uid:gid:gecos:home:shell
function parseLinuxPasswd(stdout) {
  var fields = stdout.trimEnd().split(':');
  if (fields.length !== 7)
    throw new Error('expected 7 passwd fields, got ' + fields.length);
  return {
    name: fields[0],
    uid: parseId(fields[2], 'uid'),
    gid: parseId(fields[3], 'gid'),
    home: fields[5]
  };
}

// id -P: name:passwd:uid:gid:class:change:expire:gecos:home:shell
function parseDarwinPasswd(stdout) {
  var fields = stdout.trimEnd().split(':');
  if (fields.length !== 10)
    throw new Error('expected 10 id -P fields, got ' + fields.length);
  return {
    name: fields[0],
    uid: parseId(fields[2], 'uid'),
    gid: parseId(fields[3], 'gid'),
    home: fields[8]
  };
}

// getent -- group: name:passwd:gid:members
function parseGroupEntry(stdout) {
  var fields = stdout.trimEnd().split(':');
  if (fields.length < 3)
    throw new Error('expected at least 3 group fields, got ' + fields.length);
  return {
    name: fields[0],
    gid: parseId(fields[2], 'gid')
  };
}

// dscacheutil -q group: "key: value" lines, e.g. "name: staff", "gid: 20".
function parseDscacheutilGroup(stdout) {
  var record = {};
  stdout.split('\n').forEach(function(line) {
    var m = /^([^:]+):\s*(.*)$/.exec(line);
    if (m)
      record[m[1].trim()] = m[2];
  });
  if (!record.name || record.gid === undefined)
    throw new Error('expected name and gid keys');
  return {
    name: record.name,
    gid: parseId(record.gid, 'gid')
  };
}

// id -G: whitespace-separated numeric group IDs, primary first.
function parseGroupIds(stdout) {
  var tokens = stdout.trim().split(/\s+/).filter(function(token) {
    return token.length > 0;
  });
  if (tokens.length === 0)
    throw new Error('expected at least one group ID');
  var seen = {};
  var gids = [];
  tokens.forEach(function(token) {
    var gid = parseId(token, 'group ID');
    if (!seen[gid]) {
      seen[gid] = true;
      gids.push(gid);
    }
  });
  return gids;
}

// --- Caching --------------------------------------------------------------

function cacheGet(cache, key) {
  var entry = cache.get(key);
  if (!entry)
    return {hit: false};
  if (entry.expires <= Date.now()) {
    cache.delete(key);
    return {hit: false};
  }
  return {hit: true, value: entry.value};
}

function cacheSet(cache, key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    // Map iterates in insertion order, so the first key is the oldest.
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, {
    value: value,
    expires: Date.now() +
      (value === null ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS)
  });
}

// Coalesces concurrent lookups for the same key onto one in-flight promise.
function cached_p(cache, inflight, key, loader) {
  var hit = cacheGet(cache, key);
  if (hit.hit)
    return Promise.resolve(hit.value);

  var pending = inflight.get(key);
  if (pending)
    return pending;

  var promise = Promise.resolve().then(loader).then(function(value) {
    cacheSet(cache, key, value);
    inflight.delete(key);
    return value;
  }, function(err) {
    inflight.delete(key);
    throw err;
  });
  inflight.set(key, promise);
  return promise;
}
