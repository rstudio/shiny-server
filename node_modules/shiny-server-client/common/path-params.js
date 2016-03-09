"use strict";

var assert = require("assert");

exports.addPathParams = function(url, params) {
  var pathFragment = "";
  for (var key in params) {
    if (params.hasOwnProperty(key)) {
      if (!/^\w*$/.test(key) || !/^\w*$/.test(params[key])) {
        throw new Error("util.addPathParams doesn't implement escaping");
      }
      pathFragment += "/" + key + "=" + params[key];
    }
  }
  return url.replace(/\/?(\?|$)/, pathFragment + "$1");
};

function parseUrl(url) {
  var urlParts = /^([^?]*)(\?.*)?$/.exec(url);
  assert(urlParts);

  // Could be full URL, absolute path, or relative path
  var mainUrl = urlParts[1];
  var search = urlParts[2] || ""; // Could be nothing

  var chunks = mainUrl.split(/\//);

  // Find first chunk that's either "" or "name=value"
  var firstParamIndex = chunks.length;
  var lastParamIndex;
  var seenParam = false; // Have we encountered any param yet?
  while (firstParamIndex > 0) {
    var prevChunk = chunks[firstParamIndex-1];
    if (/^[a-z]+=/i.test(prevChunk)) {
      if (!lastParamIndex)
        lastParamIndex = firstParamIndex;
      seenParam = true;
      firstParamIndex--;
    } else if (!seenParam) {
      firstParamIndex--;
    } else {
      break;
    }
  }

  // No params detected
  if (!seenParam) {
    return {
      prefix: chunks,
      params: [],
      suffix: [],
      search: search
    };
  }

  assert(firstParamIndex >= 0 && firstParamIndex <= chunks.length);
  assert(lastParamIndex >= 0 && firstParamIndex <= chunks.length);

  return {
    prefix: chunks.slice(0, firstParamIndex),
    params: chunks.slice(firstParamIndex, lastParamIndex),
    suffix: chunks.slice(lastParamIndex),
    search: search
  };
}

function formatUrl(urlObj) {
  var url = []
    .concat(urlObj.prefix)
    .concat(urlObj.params)
    .concat(urlObj.suffix)
    .join("/");
  return url + urlObj.search;
}

exports.reorderPathParams = function(url, order) {
  var urlObj = parseUrl(url);

  // Filter out empty chunks
  var params = urlObj.params.filter(function(v) { return v.length > 0; });

  // Now actually reorder the chunks
  var frontParams = [];
  for (var i = 0; i < params.length; i++) {
    var m = /^(.+)=(.*)$/.exec(params[i]);
    assert(m);
    var desiredOrder = order.indexOf(m[1]);
    if (desiredOrder >= 0) {
      frontParams[desiredOrder] = params[i];
      delete params[i];
    }
  }
  urlObj.params = frontParams.concat(params).filter(function(v) { return typeof(v) !== "undefined"; });

  return formatUrl(urlObj);
};

exports.extractParams = function(url) {
  var urlObj = parseUrl(url);
  var result = {};
  for (var i = 0; i < urlObj.params.length; i++) {
    var m = /^(.+)=(.*)$/.exec(urlObj.params[i]);
    result[m[1]] = m[2];
  }
  return result;
};
