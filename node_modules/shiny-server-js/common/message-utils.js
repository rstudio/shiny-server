exports.formatId = formatId;
function formatId(id) {
  return id.toString(16).toUpperCase();
};

exports.parseId = parseId;
function parseId(str) {
  return parseInt(str, 16);
};

exports.parseTag = function(val) {
  var m = /^([\dA-F]+)#(.*)$/.exec(val);
  if (!m) {
    return null;
  }

  return {
    id: parseId(m[1]),
    data: m[2]
  };
};

exports.parseCONTINUE = function(val) {
  var m = /^CONTINUE ([\dA-F]+)$/.exec(val);
  if (!m) {
    return null;
  }
  return parseId(m[1]);
};

exports.parseACK = function(val) {
  var m = /^ACK ([\dA-F]+)$/.exec(val);
  if (!m) {
    return null;
  }
  return parseId(m[1]);
};
