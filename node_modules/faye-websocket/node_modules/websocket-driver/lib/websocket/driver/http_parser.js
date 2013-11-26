var HTTPParser = process.binding('http_parser').HTTPParser,
    version    = HTTPParser.RESPONSE ? 6 : 4;

var HttpParser = function(type) {
  if (type === 'request')
    this._parser = new HTTPParser(HTTPParser.REQUEST || 'request');
  else
    this._parser = new HTTPParser(HTTPParser.RESPONSE || 'response');

  this._type     = type;
  this._complete = false;
  this.headers   = {};

  var current = null,
      self    = this;

  this._parser.onHeaderField = function(b, start, length) {
    current = b.toString('utf8', start, start + length).toLowerCase();
  };

  this._parser.onHeaderValue = function(b, start, length) {
    self.headers[current] = b.toString('utf8', start, start + length);
  };

  this._parser.onHeadersComplete = function(info) {
    self.method     = info.method;
    self.statusCode = info.statusCode;
    self.url        = info.url;
    
    var headers = info.headers;
    if (!headers) return;

    for (var i = 0, n = headers.length; i < n; i += 2)
      self.headers[headers[i].toLowerCase()] = headers[i+1];
  };

  this._parser.onMessageComplete = function() {
    self._complete = true;
  };
};

HttpParser.prototype.isComplete = function() {
  return this._complete;
};

HttpParser.prototype.parse = function(data) {
  var offset   = (version < 6) ? 1 : 0,
      consumed = this._parser.execute(data, 0, data.length) + offset;

  if (this._complete)
    this.body = (consumed < data.length)
              ? data.slice(consumed)
              : new Buffer(0);
};

module.exports = HttpParser;

