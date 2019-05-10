/*
 * test/http-proxy.js
 *
 * Copyright (C) 2018 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
const assert = require("assert");
const http = require("http");
const httpProxy = require("http-proxy");

describe("http-proxy", () => {  
  it("doesn't use keepalive on proxied requests", done => {

    // It's important that the http-proxy library we rely on, always make
    // requests upstream with "Connection: close", both because Node.js may not
    // handle keepalive correct (we're not sure) and also because versions of
    // httpuv <= 1.3.6 had a bug where it wouldn't clear out headers correctly
    // between requests on the same socket. This test sets up
    //
    //   client -> proxyServer -> upstreamServer
    //
    // and makes sure that client -> proxyServer requests have keepalive enabled
    // and proxyServer -> upstreamServer requests do not. If this test ever
    // fails, it means http-proxy no longer has the behavior we want and we'll
    // have to write additional code to turn off keepalive. Commit eb73244289b17
    // may be instructive.

    const upstreamServer = http.createServer((req, res) => {
      try {
        assert.equal(req.headers.connection, "close");
        done();
      } catch(err) {
        done(err);
      } finally {
        res.end();
      }
    });
    upstreamServer.listen(9111);
    
    const proxy = httpProxy.createProxyServer({
      target: "http://localhost:9111"
    });

    upstreamServer.on('error', function(err) {});
    proxy.on('error', function(err) {});

    const proxyServer = http.createServer((req, res) => {
      try {
        assert.equal(req.headers.connection, "keep-alive");
        proxy.web(req, res);
      } catch (err) {
        done(err);
        res.end();
      }
    });
    proxyServer.listen(9112);

    const keepAliveAgent = new http.Agent({ keepAlive: true });

    function cleanup() {
      proxyServer.close();
      upstreamServer.close();
      keepAliveAgent.destroy();
    }

    let req = http.get({
      host: "localhost",
      port: 9112,
      agent: keepAliveAgent
    }, res => {
      res.on("data", () => {});
      res.on("end", cleanup);
    });
    req.on("error", done);
  });
});
