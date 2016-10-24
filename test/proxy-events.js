/*
 * test/proxy-events.js
 *
 * Copyright (C) 2009-16 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

const child_process = require("child_process");

const bash = require("bash");
const _ = require("underscore");

const proxy_http = require("../lib/proxy/http");

describe("http-proxy", () => {

  // Burned several times now by http-proxy changing its events. Let's
  // at least fail some tests if they add or remove event names.
  it("has not changed its supported events", (done) => {
    let knownEvents = proxy_http.knownEvents;

    let pipeline = [
      // Find all instances of ".emit(..."
      // Since we're using -o and -h, only the actual matches will be printed
      ["grep", "-Roh", "\\.emit([^,]\\+", "node_modules/http-proxy"],
      // Strip the ".emit(" prefix
      ["sed", "s/\\.emit(//"],
      // Strip quotation marks, whitespace
      ["sed", "s/['\" ]//g"],
      // Remove dupes with sort+uniq
      ["sort"],
      ["uniq"]
    ];

    pipeline = _.map(pipeline, (args) => bash.escape.apply(bash, args));

    child_process.exec(pipeline.join("|"),
      (error, stdout, stderr) => {
        if (error) {
          done(error);
          return;
        }

        let actualEvents = stdout.trim().split("\n");

        let fictional = _.difference(proxy_http.knownEvents, actualEvents);
        let discovered = _.difference(actualEvents, proxy_http.knownEvents);

        if (fictional.length > 0) {
          done(new Error("Detected fictional event(s): " + fictional.join(", ")));
          return;
        }
        if (discovered.length > 0) {
          done(new Error("Discovered new event(s): " + discovered.join(", ")));
          return;
        }
        done();
      }
    );

  });
});