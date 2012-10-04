passwd(4) and group(4)
======================

Interface to read a standard Unix passwd and group file-format

Install
------

Install locally to use as a module

    npm install etc-passwd

Usage
-----

as a module

``` js
var passwd = require('etc-passwd');
```

Functions
---------

### passwd.getUsers([file])

Get all users found in `file`. This functions returns an instance of `EventEmitter`.

The optional parameter `file` defaults to `/etc/passwd`

#### .on('user', function(user) {})

Returns an object whenever a user is found

#### .on('end', function() {})

Called when the file is done being read

### passwd.getUsers([file], callback(users))

If a callback is supplied as the last argument, the entire file will be read at once,
and the results will be returned as a list of user objects.  This is good for convenience,
but can produce unnecessary overhead on systems with a lot of users.

---

### passwd.getUser({'username':'root'}, [file], callback(err, user))

Look for a specific username in `file` (defaults to `/etc/passwd`).  This will use the
EventEmitter to avoid loading the entire file into memory and return the callback
when the user is found.  If the user is not found `err` will be set and `user` will be null.
You can specify any attribute to look for as the first argument.

---

### passwd.getGroups([file])

Get all groups found in `file`. This functions returns an instance of `EventEmitter`.

The optional parameter `file` defaults to `/etc/group`

#### .on('group', function(group) {})

Returns an object whenever a group is found

#### .on('end', function() {})

Called when the file is done being read

### passwd.getGroups([file], callback(groups))

If a callback is supplied as the last argument, the entire file will be read at once,
and the results will be returned as a list of group objects.  This is good for convenience,
but can produce unnecessary overhead on systems with a lot of groups.

---

### passwd.getGroup({'groupname':'wheel'}, [file], callback(err, group))

Look for a specific groupname in `file` (defaults to `/etc/group`).  This will use the
EventEmitter to avoid loading the entire file into memory and return the callback
when the group is found.  If the group is not found `err` will be set and `group` will be null.
You can specify any attribute to look for as the first argument.

Example
-------

### passwd.getUsers()

An example of using the EventEmitter interface to find users

``` js
var passwd = require('passwd'),
    users = passwd.getUsers();

users.on('user', function(user) {
  console.log(JSON.stringify(user));
});
users.on('end', function() {
  console.log('Done.');
});
```

    {"username":"nobody","password":"*","uid":-2,"gid":-2,"comments":"Unprivileged User","home":"/var/empty","shell":"/usr/bin/false"}
    {"username":"root","password":"*","uid":0,"gid":0,"comments":"System Administrator","home":"/var/root","shell":"/bin/sh"}
    ...
    Done.

### passwd.getUsers(callback(users))

Using the callback instead of the EventEmitter to get the results

``` js
var passwd = require('passwd');
passwd.getUsers(function(users) {
  console.log(JSON.stringify(users));
});
```

``` json
[
{"username":"nobody","password":"*","uid":-2,"gid":-2,"comments":"Unprivileged User","home":"/var/empty","shell":"/usr/bin/false"},
{"username":"root","password":"*","uid":0,"gid":0,"comments":"System Administrator","home":"/var/root","shell":"/bin/sh"},
...
]
```

### passwd.getUser()

As for a specific user on the system

``` js
var passwd = require('etc-passwd');
passwd.getUser({'username':'root'}, function(err, user) {
  console.log(JSON.stringify(user));
});
```

``` json
{
  "username": "root",
  "password": "*",
  "uid": 0,
  "gid": 0,
  "comments": "System Administrator",
  "home": "/var/root",
  "shell": "/bin/sh"
}
```

---

### passwd.getGroups()

An example of using the EventEmitter interface to find groups

``` js
var passwd = require('passwd'),
    groups = passwd.getGroups();

groups.on('group', function(group) {
  console.log(JSON.stringify(group));
});
groups.on('end', function() {
  console.log('Done.');
});
```

    {"groupname":"nobody","password":"*","gid":-2,"users":[]}
    {"groupname":"nogroup","password":"*","gid":-1,"users":[]}
    ...
    Done.

### passwd.getGroups(callback(groups))

Using the callback instead of the EventEmitter to get the results

``` js
var passwd = require('passwd');
passwd.getGroups(function(groups) {
  console.log(JSON.stringify(groups));
});
```

``` json
[
{"groupname":"nobody","password":"*","gid":-2,"users":[]}
{"groupname":"nogroup","password":"*","gid":-1,"users":[]}
...
]
```

### passwd.getGroup()

``` js
var passwd = require('etc-passwd');
passwd.getGroup({'groupname':'wheel'}, function(err, group) {
  console.log(JSON.stringify(group));
});
```

``` json
{
  "groupname": "wheel",
  "password": "*",
  "gid": 0,
  "users": [
    "root"
  ]
}
```

License
-------

MIT Licensed
