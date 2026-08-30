/*
 * test/support/config.js
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

// Builds throwaway shiny-server.conf files in a temp directory.
//
// Config text is written with $-placeholders rather than as static fixture
// files, because two of the values can only be known at run time: the user the
// test process happens to be running as (run_as must name a user that the
// account database can resolve and that the process is allowed to become),
// and the absolute path of the checkout.

var fs = require('fs');
var os = require('os');
var path = require('path');
var paths = require('../../lib/core/paths');
var permissions = require('../../lib/core/permissions');

// The user this process is running as. Suitable for `run_as`, because
// permissions.canRunAs() always accepts it.
exports.processUser = permissions.getProcessUser();

exports.projectRoot = paths.projectRoot;

/**
 * Creates a temp directory with a config file in it.
 *
 * @param {string} text - The config file body. These substitutions are applied:
 *   `$USER` -> the user this process runs as, `$ROOT` -> the checkout root,
 *   `$DIR` -> the temp directory the config was written into (handy for
 *   log_dir and site_dir).
 * @param {object} [files] - Extra files to create alongside the config, as a
 *   map of relative path to contents. Parent directories are created.
 *
 * @returns {object} `{path, dir, cleanup()}`.
 */
exports.write = write;
function write(text, files) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiny-server-test-'));

  var body = text
    .replace(/\$USER\b/g, exports.processUser)
    .replace(/\$ROOT\b/g, paths.projectRoot.replace(/\/$/, ''))
    .replace(/\$DIR\b/g, dir);

  var configPath = path.join(dir, 'shiny-server.conf');
  fs.writeFileSync(configPath, body, 'utf8');

  Object.keys(files || {}).forEach(function(relPath) {
    var full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), {recursive: true});
    fs.writeFileSync(full, files[relPath]);
  });

  return {
    path: configPath,
    dir: dir,
    cleanup: function() {
      try {
        fs.rmSync(dir, {recursive: true, force: true});
      } catch (err) {
        // Leaving a temp dir behind is not worth failing a test over.
      }
    }
  };
}

/**
 * The config most integration tests want: one ephemeral-port server serving
 * `site_dir` out of a directory the caller controls.
 *
 * Note the listener is pinned to 127.0.0.1 rather than the default wildcard,
 * and that is not cosmetic. With `listen 0` on `::`, the OS can hand the server
 * an ephemeral port that TcpTransport has just probed-and-released for a worker
 * (tcp.js allocates by binding port 0, reading the port, and closing again).
 * The stand-in worker then binds that same port on 127.0.0.1 -- which succeeds,
 * because a specific-address bind is allowed alongside a wildcard one -- and
 * from then on shadows the server for all loopback traffic. The test client
 * silently reaches the worker instead of Shiny Server, which shows up as
 * unexplainable 404s and "Parse Error: Expected HTTP/". Binding the listener on
 * 127.0.0.1 puts it in the same address space as the worker ports, so the
 * kernel's allocator will not hand the same port out twice.
 *
 * @param {object} [opts]
 * @param {string} [opts.siteDir] - Value for site_dir. Defaults to `$DIR/site`.
 * @param {string} [opts.listen] - Value for the listen directive. Defaults to
 *   `0 127.0.0.1`.
 * @param {string} [opts.directoryIndex] - Value for directory_index. Defaults
 *   to "on". Pass null to omit the directive entirely.
 * @param {string} [opts.locationBody] - Extra directives inside `location /`.
 * @param {string} [opts.serverBody] - Extra directives inside `server`.
 * @param {string} [opts.preamble] - Extra top-level directives.
 */
exports.siteDirConfig = siteDirConfig;
function siteDirConfig(opts) {
  opts = opts || {};
  var directoryIndex = opts.directoryIndex === undefined ? 'on' : opts.directoryIndex;
  return [
    'run_as $USER;',
    opts.preamble || '',
    'server {',
    '  listen ' + (opts.listen || '0 127.0.0.1') + ';',
    opts.serverBody || '',
    '  location / {',
    '    site_dir ' + (opts.siteDir || '$DIR/site') + ';',
    '    log_dir $DIR/logs;',
    directoryIndex === null ? '' : '    directory_index ' + directoryIndex + ';',
    opts.locationBody || '',
    '  }',
    '}',
    ''
  ].join('\n');
}
