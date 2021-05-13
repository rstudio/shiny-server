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

  if (isValidIPv6(address)) {
    const addr6 = new Address6(address);
    return addr6.canonicalForm() === wildcard6.canonicalForm();
  }

  return false;
}

exports.isValid = isValid;
function isValid(addr) {
  if (typeof(addr) !== "string")
    return false;
  return isValidIPv4(addr) || isValidIPv6(addr);
}

function isValidIPv4(addr) {
  try {
    new Address4(addr);
    return true;
  } catch(e6) {
    return false;
  }
}

function isValidIPv6(addr) {
  try {
    new Address6(addr);
    return true;
  } catch(e6) {
    return false;
  }
}

exports.hasZone = hasZone;
function hasZone(addr) {
  return isValidIPv6(addr) && !!(new Address6(addr).zone);
}

exports.normalize = normalize;
function normalize(addr) {
  if (isValidIPv4(addr)) {
    return new Address4(addr).correctForm();
  }
  if (isValidIPv6(addr)) {
    let addr6 = new Address6(addr);
    return addr6.correctForm() + addr6.zone;
  }
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
  const a1 = isValidIPv4(addr1) ? Address6.fromAddress4(addr1) : new Address6(addr1);
  const a2 = isValidIPv4(addr2) ? Address6.fromAddress4(addr2) : new Address6(addr2);
  return (a1.canonicalForm() + a1.zone) === (a2.canonicalForm() + a2.zone);
}

/**
 * To use an IPv6 address as a hostname in a URL, you must wrap it in [...].
 * This function adds the brackets, if they are required.
 */
exports.addrToHostname = addrToHostname;
function addrToHostname(addr) {
  if (isValidIPv6(addr)) {
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
