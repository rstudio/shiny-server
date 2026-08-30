/*
 * test/python.js
 *
 * Copyright (C) 2009-13 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var should = require('should');

var python = require('../lib/core/python.js');

// Build a throwaway directory shaped like a venv (or not, per `withBin`).
function makeVenv(withBin) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiny-server-python-'));
  if (withBin) {
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(path.join(root, 'bin', 'python'), '#!/bin/sh\n');
    fs.chmodSync(path.join(root, 'bin', 'python'), 0o755);
  }
  return root;
}

describe('resolvePython_p', function() {
  var tmpdirs = [];
  afterEach(function() {
    tmpdirs.splice(0).forEach(function(d) {
      fs.rmSync(d, {recursive: true, force: true});
    });
  });

  it('explains a path that does not exist, rather than leaking ENOENT', function() {
    var missing = path.join(os.tmpdir(), 'shiny-server-no-such-venv-' + Date.now());
    return python.resolvePython_p(missing).then(function() {
      throw new Error('should have rejected');
    }, function(err) {
      err.message.should.containEql(missing);
      err.message.should.containEql('does not exist');
      // The bare fs error is what we are specifically replacing.
      err.message.should.not.containEql('ENOENT');
    });
  });

  it('resolves a relative path against the app dir before reporting it missing', function() {
    var appDir = makeVenv(false);
    tmpdirs.push(appDir);
    return python.resolvePython_p('.venv/', appDir).then(function() {
      throw new Error('should have rejected');
    }, function(err) {
      // The message should name the resolved location, not the bare `.venv/`.
      err.message.should.containEql(path.join(appDir, '.venv'));
      err.message.should.containEql('does not exist');
    });
  });

  it('rejects a directory that exists but has no bin/python', function() {
    var dir = makeVenv(false);
    tmpdirs.push(dir);
    return python.resolvePython_p(dir).then(function() {
      throw new Error('should have rejected');
    }, function(err) {
      err.message.should.containEql('does not contain bin/python');
    });
  });

  it('accepts a virtual environment directory', function() {
    var venv = makeVenv(true);
    tmpdirs.push(venv);
    return python.resolvePython_p(venv).then(function(result) {
      result.exec.should.equal(path.join(venv, 'bin', 'python'));
      result.path_prepend.should.equal(path.join(venv, 'bin'));
      result.env.virtual_env.should.equal(venv);
      should(result.env.pythonhome).be.null();
    });
  });

  it('passes a bare name through as a command, to be found on PATH later', function() {
    return python.resolvePython_p('python3').then(function(result) {
      result.command.should.equal('python3');
      should(result.exec).be.undefined();
    });
  });
});
