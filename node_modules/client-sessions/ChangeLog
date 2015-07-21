0.7.0 -
	* add `session.destroy()` alias for `session.reset()`
	* invalid base64 will return undefined instead of throw

0.6.0 -
	* add secret can also be a Buffer
	* add `encryptonKey` and `signatureKey` options, to be used instead of `secret`
	* add `encryptionAlgorithm` and `signatureAlgorithm` options
	* fix zero out buffers during encryption
	* docs for new crypto options
	* docs describing how crypto is used

0.5.0 -
	* fix dirty checking for nested objects. req.session.foo.bar = 'baz' now works.
	* fix setting req.session = someObj will update from someObj
	* removed usage of Proxy, now uses getters/setters

0.4.1 -
	* change to writeHead, no longer depending on connect's res.on('header') event
	* fix checking existence of res.socket before checking res.socket.encrypted
	* documentation added js syntax highlighting

0.4.0 -
	* add activeDuration with default to 5 minutes
	* add checking for native Proxy before using node-proxy
	* add cookie.ephemeral option, default false
	* add constant-time check
	* adds self-aware check. wont override req.session if already exists
	* fix wrong handled of utf8 replacement character
	* fix http expiry of cookie to match duration
	* fix updating cookie expiry whenever duration/createdAt changes

0.3.1 -
	* documentation update
	* support opt.requestKey to allow usage of a key other than cookie name

0.1.0 -
	* node 0.10.x support
	* fix bug in .reset() - session would load from an existing cookie - thanks @khmelichek
