/*
 * test/iputil.js
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
const iputil = require("../lib/core/iputil");

describe("iputil", () => {  

  it("validates addresses", () => {
    const yes = [
      "127.0.0.1",
      "255.255.255.255",
      "0.0.0.0",
      "::1",
      "::01",
      "::001",
      "::0001",
      "fe80::1b38:f53:e5f2:f9e2",
      "fe80:1b38:f53:e5f2::f9e2",
      "fe80::1b38:f53:e5f2:f9e2%ens33",
      "0000:0000:0000:0000:0000:0000:0000:0000",
    ];
    yes.forEach(x => assert(iputil.isValid(x)));

    const no = [
      "0000:0000:0000:0000:0000:0000:0000:0000:00000",
      "0000:0000:0000:0000:0000:0000:0000:0000:0000",
      "0000:0000:0000:0000:0000:0000:0000",
      "    127.0.0.1  ",
      "255.255.255.256",
      "test",
      ":::1",
      "12",
      12,
      "*",
      ".",
      false,
      null,
    ];
    no.forEach(x => assert(!iputil.isValid(x)));
  });

  it("identifies wildcards", () => {
    assert(iputil.isWildcard("*"));

    assert(iputil.isWildcard("0.0.0.0"));
    assert(iputil.isWildcard("::0"));
    assert(iputil.isWildcard("::0000"));
    assert(iputil.isWildcard("0:0:0::0000"));
  });

  it("normalizes", () => {
    assert.equal(iputil.normalize("::1"), "::1");
    assert.equal(iputil.normalize("0:0:0::1"), "::1");
    assert.equal(iputil.normalize("fe80::1b38:f53:e5f2:f9e2%ens33"), "fe80::1b38:f53:e5f2:f9e2%ens33");
  });

  it("implicitly normalizes when testing for equality", () => {
    assert(iputil.equal("::ffff:10.11.12.13", "10.11.12.13"));
    assert(iputil.equal("127.0.0.1", "127.0.0.1"));

    assert(!iputil.equal("10.11.12.13", "10.11.12.14"));
    assert(!iputil.equal("127.0.0.1", "::1"));

    assert(!iputil.equal("fe80::1b38:f53:e5f2:f9e2%ens33", "fe80::1b38:f53:e5f2:f9e2"));
  });

  it("wraps in [] appropriately", () => {
    assert.equal(iputil.addrToHostname("::"), "[::]");
    assert.equal(iputil.addrToHostname("::1"), "[::1]");
    assert.equal(iputil.addrToHostname("::ffff:10.11.12.13"), "[::ffff:10.11.12.13]");
    assert.equal(iputil.addrToHostname("*"), "*");
    assert.equal(iputil.addrToHostname("1.2.3.4"), "1.2.3.4");
    assert.equal(iputil.addrToHostname("www.rstudio.com"), "www.rstudio.com");
  });

  it("unwraps [] appropriately", () => {
    assert.equal(iputil.hostnameToAddr(""), "");
    assert.equal(iputil.hostnameToAddr("www.rstudio.com"), "www.rstudio.com");
    assert.equal(iputil.hostnameToAddr("[::1]"), "::1");
    // We're not expecting this, but whatever--being liberal
    assert.equal(iputil.hostnameToAddr("[foo]"), "foo");
    // Spaces not allowed. Still don't throw, but don't remove either.
    assert.equal(iputil.hostnameToAddr(" [::1] "), " [::1] ");
    // Again, not legal, but whatever.
    assert.equal(iputil.hostnameToAddr("a[::1]b"), "a[::1]b");
  });

  it("detects zones", () => {
    assert(iputil.hasZone("fe80::1ff:fe23:4567:890a%eth2"));
    assert(!iputil.hasZone("fe80::1ff:fe23:4567:890a"));

    // invalid
    assert(!iputil.hasZone("whatever"));
    assert(!iputil.hasZone("8.8.8.8"));
    assert(!iputil.hasZone("8.8.8.8%eth2"));
  });
});
