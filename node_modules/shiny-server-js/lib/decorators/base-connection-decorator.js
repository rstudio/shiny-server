module.exports = BaseConnectionDecorator;

function BaseConnectionDecorator(conn) {
  this._conn = conn;
  conn.onopen = this._handleOpen.bind(this);
  conn.onmessage = this._handleMessage.bind(this);
  conn.onerror = this._handleError.bind(this);
  conn.onclose = this._handleClose.bind(this);
}

BaseConnectionDecorator.prototype.send = function(data) {
  this._conn.send(data);
};

BaseConnectionDecorator.prototype.close = function() {
  return this._conn.close();
};

BaseConnectionDecorator.prototype._handleOpen = function() {
  if (this.onopen) {
    this.onopen.apply(this, arguments);
  }
};
BaseConnectionDecorator.prototype._handleMessage = function() {
  if (this.onmessage) {
    this.onmessage.apply(this, arguments);
  }
};
BaseConnectionDecorator.prototype._handleError = function() {
  if (this.onerror) {
    this.onerror.apply(this, arguments);
  }
};
BaseConnectionDecorator.prototype._handleClose = function() {
  if (this.onclose) {
    this.onclose.apply(this, arguments);
  }
};

Object.defineProperty(BaseConnectionDecorator.prototype, "readyState", {
  get: function readyState() {
    return this._conn.readyState;
  }
});
Object.defineProperty(BaseConnectionDecorator.prototype, "url", {
  get: function readyState() {
    return this._conn.url;
  }
});
Object.defineProperty(BaseConnectionDecorator.prototype, "protocol", {
  get: function readyState() {
    return this._conn.protocol;
  }
});
Object.defineProperty(BaseConnectionDecorator.prototype, "extensions", {
  get: function readyState() {
    return this._conn.extensions;
  }
});
