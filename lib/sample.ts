/// <reference path="node.d.ts" />
var AppSpec = require('./worker/app-spec');

new AppSpec("dir", "runas", "prefix", "logdir", {});

