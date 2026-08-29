/*
 * test/integration-r/real-app.js
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

// The slow tier: a real R process, launched by the real AppWorker, serving a
// real Shiny app. Everything test/integration/ stubs out is live here -- the
// stdin handshake, the port handshake, per-worker logging, teardown.
//
// This is NOT part of `npm test`; run it with `npm run test:r`. It needs R with
// the `shiny` package installed, and it skips itself (loudly) if that is
// missing rather than failing, so that a developer without R still gets a
// useful signal from the rest of the suite.
//
// Note that these run as the current user: AppWorker only shells out to `su`
// when appSpec.runAs differs from the process user (app-worker.ts:325), so a
// `run_as $USER` config exercises the real launcher without needing root.

var assert = require('assert');
var child_process = require('child_process');
var fs = require('fs');
var path = require('path');
var testServer = require('../support/server');
var testConfig = require('../support/config');

var HELLO_APP = path.join(testConfig.projectRoot, 'test', 'apps', '01_hello');

/**
 * True if `Rscript` exists and can load shiny.
 */
function hasShiny() {
  try {
    var result = child_process.spawnSync('Rscript', [
      '-e', 'quit(status = if (requireNamespace("shiny", quietly = TRUE)) 0 else 1)'
    ], {timeout: 60000});
    return result.status === 0;
  } catch (err) {
    return false;
  }
}

describe('a real R Shiny app', function() {
  // R startup plus package loading is slow, and slower still on a cold CI
  // machine. app_init_timeout in the config below has to stay under this.
  this.timeout(120000);

  var available = hasShiny();
  var server;

  before(function() {
    if (!available) {
      console.warn(
        '\n  SKIPPING the real-R tier: Rscript with the "shiny" package was ' +
        'not found.\n  Install R and `install.packages("shiny")` to run it.\n');
      this.skip();
    }

    return testServer.start_p(testConfig.siteDirConfig({
      siteDir: '$DIR/site',
      // Without an explicit bookmark_state_dir the worker tries to mkdir
      // /var/lib/shiny-server/bookmarks and fails before R is ever started.
      preamble: 'bookmark_state_dir $DIR/bookmarks;',
      locationBody: '    app_init_timeout 90;\n    app_idle_timeout 30;'
    }), {
      // The whole point: leave the real launcher in place.
      worker: false,
      files: {
        'site/hello/ui.R': fs.readFileSync(path.join(HELLO_APP, 'ui.R')),
        'site/hello/server.R': fs.readFileSync(path.join(HELLO_APP, 'server.R')),
        'bookmarks/.keep': ''
      }
    })
    .then(function(s) { server = s; });
  });

  after(function() {
    return server ? server.stop_p() : null;
  });

  it('starts R and serves the app page', function() {
    return server.get_p('/hello/', {timeout: 110000}).then(function(r) {
      assert.strictEqual(r.status, 200);
      assert.ok(/<html/i.test(r.body),
        'expected an HTML page, got: ' + r.body.slice(0, 300));
      // Shiny's page always pulls in its own JS bundle.
      assert.ok(/shiny/i.test(r.body),
        'expected the Shiny page scaffolding, got: ' + r.body.slice(0, 500));
    });
  });

  it('serves shiny-server assets under the running app\'s prefix', function() {
    // The app page injects <link href=".../__assets__/shiny-server.css">; the
    // asset middleware strips everything up to and including __assets__, so it
    // resolves to the same file as the top-level URL would.
    return server.get_p('/hello/__assets__/shiny-server.css').then(function(r) {
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.length > 0);
    });
  });

  it('injects the shiny-server client into the app page', function() {
    return server.get_p('/hello/').then(function(r) {
      assert.ok(/__assets__\/shiny-server\.css/.test(r.body),
        'expected the injected stylesheet link, got: ' + r.body.slice(0, 800));
    });
  });

  it('reuses the same R process for a second request', function() {
    return server.get_p('/hello/').then(function(r) {
      assert.strictEqual(r.status, 200);
      var entries = server.workerEntries();
      assert.strictEqual(entries.length, 1,
        'a second request should not have spawned a second R process');
    });
  });

  it('proxies R\'s own static assets, not just the app page', function() {
    // /shared/ is served by Shiny itself from inside the R process, so a
    // sizeable, correctly-typed body here means the proxy is round-tripping
    // real traffic to a live R process and not just serving the first page.
    return server.get_p('/hello/shared/shiny.js').then(function(r) {
      assert.strictEqual(r.status, 200);
      assert.ok(/javascript/.test(r.headers.get('content-type')),
        'unexpected content-type: ' + r.headers.get('content-type'));
      assert.ok(r.body.length > 10000,
        'expected the real shiny.js bundle, got ' + r.body.length + ' bytes');
    });
  });

  it('404s a path the R process does not recognize', function() {
    // The 404 comes from Shiny, not from Shiny Server, which is the point:
    // the request reached R and R answered.
    return server.get_p('/hello/session/nonexistent').then(function(r) {
      assert.strictEqual(r.status, 404);
    });
  });

  it('captures the R process\'s stderr into a per-worker log file', function() {
    // Asserting only that a hello-*.log exists proves nothing: the file is
    // created before the worker is launched, so it is there even when R fails
    // to start at all (which is exactly what happened before
    // bookmark_state_dir was set). Assert the content, and that the port in
    // the filename matches the port R reports listening on -- that is what
    // makes it a *per-worker* log.
    var logDir = path.join(server.config.dir, 'logs');
    var files = fs.readdirSync(logDir).filter(function(f) {
      return /^hello-.*\.log$/.test(f);
    });
    assert.strictEqual(files.length, 1,
      'expected exactly one worker log in ' + logDir + ', found: ' + files.join(', '));

    var port = files[0].match(/-(\d+)\.log$/);
    assert.ok(port, 'log filename should end in the endpoint port: ' + files[0]);

    var contents = fs.readFileSync(path.join(logDir, files[0]), 'utf8');
    assert.ok(contents.indexOf('Listening on http://127.0.0.1:' + port[1]) >= 0,
      'expected R to report listening on port ' + port[1] + '; log was: ' +
      JSON.stringify(contents));
  });

  it('still routes normally for URLs that are not the live app', function() {
    // A control: this 404 comes from Shiny Server's router, not from R -- there
    // is no /nosuchapp directory. It is here to show that hosting a live R
    // process doesn't disturb ordinary routing. (It is also the one assertion
    // in this file that would still pass if R never started, along with the
    // __assets__ one above; everything else fails loudly.)
    return server.get_p('/nosuchapp/').then(function(r) {
      assert.strictEqual(r.status, 404);
    });
  });
});
