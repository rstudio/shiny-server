/*
 * iputil.js
 *
 * Copyright (C) 2009-18 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
const { Address4, Address6 } = require("ip-address");

const wildcard6 = new Address6("::");

exports.isWildcard = isWildcard;
function isWildcard(address) {
  if (address === "*" || address === "0.0.0.0") {
    return true;
  }

  const addr6 = new Address6(address);
  if (addr6.isValid()) {
    return addr6.canonicalForm() === wildcard6.canonicalForm();
  }

  return false;
}

exports.isValid = isValid;
function isValid(addr) {
  if (typeof(addr) !== "string")
    return false;
  return new Address4(addr).isValid() || new Address6(addr).isValid();
}

exports.normalize = normalize;
function normalize(addr) {
  const addr4 = new Address4(addr);
  if (addr4.isValid())
    return addr4.correctForm();
  const addr6 = new Address6(addr);
  if (addr6.isValid())
    return addr6.correctForm();
  throw new Error(`Invalid IP address: "addr"`);
}

exports.equal = equal;
function equal(addr1, addr2) {
  if (!isValid(addr1) || !isValid(addr2)) {
    throw new Error("Can't compare invalid IP address");
  }

  // short circuit if they are exactly equal
  if (addr1 === addr2) {
    return true;
  }

  // normalize and compare
  const a1 = new Address4(addr1).isValid() ? Address6.fromAddress4(addr1) : new Address6(addr1);
  const a2 = new Address4(addr2).isValid() ? Address6.fromAddress4(addr2) : new Address6(addr2);
  return a1.canonicalForm() === a2.canonicalForm();
}

/**
 * To use an IPv6 address as a hostname in a URL, you must wrap it in [...].
 * This function adds the brackets, if they are required.
 */
exports.addrToHostname = addrToHostname;
function addrToHostname(addr) {
  if (new Address6(addr).isValid()) {
    return `[${addr}]`;
  } else {
    return addr;
  }
}

/**
 * To use an IPv6 address as a hostname in a URL, you must wrap it in [...].
 * This function removes the brackets, if they are present. It doesn't validate
 * the address though.
 */
exports.hostnameToAddr = hostnameToAddr;
function hostnameToAddr(hostname) {
  const m = /^\[(.+)\]$/.exec(hostname);
  if (m) {
    return m[1];
  } else {
    return hostname;
  }
}
