/*
 * test/robust-sockjs.js
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

var RobustSockJS = require('../lib/proxy/robust-sockjs');
var sinon = require('sinon');
var should = require('should');
var _ = require('underscore');

describe('RobustSockJS', function(){
  describe('#robustify', function(){
    it('passes through on invalid URL', function(){
      var rsjs = new RobustSockJS();
      var conn = {url: 'blah', close: sinon.spy(), write: sinon.spy()};
      var result = rsjs.robustify(conn);
      (conn === result).should.be.true;
    });
    it('handles all 4 cases properly', function(){
      var rsjs = new RobustSockJS();
      _.size(rsjs._connections).should.equal(0);

      // Fresh connections work
      var conn = {
        url: '/__sockjs__/n=1234/',
        close: sinon.spy(),
        write: function(){}
      };
      var rob = rsjs.robustify(conn);
      _.size(rsjs._connections).should.equal(1);
      (conn === rob).should.be.false;

      // ID collisions fail
      var rob2 = rsjs.robustify(conn);
      _.size(rsjs._connections).should.equal(1);
      (rob2 === undefined).should.be.true;

      // Reconnects succeed.
      conn.url = conn.url.replace(/\/n=/, '/o=');
      var rob3 = rsjs.robustify(conn);
      _.size(rsjs._connections).should.equal(1);
      (rob3 === undefined).should.be.true;

      // Reconnects of expired/invalid IDs fail.
      conn.url = conn.url.replace(/1234/, 'abcd');
      var rob4 = rsjs.robustify(conn);
      _.size(rsjs._connections).should.equal(1);
      (rob4 === undefined).should.be.true;
    });
    it('buffers disconnects', function(){
      var clock = sinon.useFakeTimers();
      var rsjs = new RobustSockJS(1); //Timeout after 1 sec
      var conn = {
        url: '/__sockjs__/n=1234/',
        close: sinon.spy(),
        write: function(){},
        emit: function(){}
      };

      rob = rsjs.robustify(conn);
      _.size(rsjs._connections).should.equal(1);

      conn.emit('close');
      conn.emit('end');

      clock.tick(500);

      // Should still be available
      _.size(rsjs._connections).should.equal(1);

      // Reconnect
      conn.url = conn.url.replace(/\/n=/, '/o=');
      rsjs.robustify(conn);

      clock.tick(750);

      conn.emit('close');
      conn.emit('end');

      _.size(rsjs._connections).should.equal(1);

      clock.tick(1250);

      _.size(rsjs._connections).should.equal(0);

      clock.restore();
    });
  });
});
