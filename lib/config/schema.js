/*
 * schema.js
 *
 * Copyright (C) 2009-13 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
var assert = require('assert');
var fs = require('fs');
var util = require('util');
var _ = require('underscore');
var map = require('../core/map.js');

exports.applySchema = applySchema;
function applySchema(configRoot, schemaRoot) {
  var rules = map.create();
  _.each(schemaRoot.children, function(child) {
    rules[child.name] = new ConfigSchemaRule(child);
  });

  _.each(configRoot.search(true, false), function(node) {
    var rule = rules[node.name];
    if (!rule)
      throwForNode(node, new Error('Unknown directive "' + node.name + '"'));
    rule.applyTo(node);
  });

  return configRoot;
}

function ConfigSchemaRule(configNode) {
  this.$name = configNode.name;
  var at = configNode.getOne('at', false);
  if (!at) {
    throwForNode(configNode, new Error('Bad schema: Missing "at" directive'));
  }
  this.$at = _.map(at.args, function(arg) {
    return (arg === '$') ? null : arg;
  });
  this.$precludes = configNode.getOne('precludes', false);
  if (this.$precludes)
    this.$precludes = this.$precludes.args;
  this.$maxcount = configNode.getValue('maxcount', 1/0);
  this.$params = _.map(configNode.getAll('param'), function(n) {
    return new ConfigSchemaParam(n);
  });
  this.$minParams = _.reduce(this.$params, function(memo, p) {
    return memo + ((p.optional || p.vararg) ? 0 : 1);
  }, 0);
  this.$maxParams = _.reduce(this.$params, function(memo, p) {
    return memo + (p.vararg ? 1/0 : 1);
  }, 0);
  if (_.uniq(_.pluck(this.$params, 'name')).length != this.$params.length) {
    throwForNode(configNode, new Error('Not all param names were unique'));
  }

  // Make sure we have required, optional, vararg, in that order
  _.reduce(this.$params, function(memo, p) {
    if (p.required) {
      if (memo > 0)
        throwForNode(configNode,
            new Error('Required parameter defined after non-required'));
      return 0;
    }
    if (p.optional) {
      if (memo > 1)
        throwForNode(configNode,
            new Error('Optional parameter defined after vararg'));
      return 1;
    }
    if (p.vararg) {
      if (memo == 2)
        throwForNode(configNode,
            new Error('Only one vararg can be defined per directive'));
      return 2;
    }
  }, 0);

}
(function() {
  this.applyTo = function(node) {
    this.$validateLocation(node);
    this.$validateAndTransformArgs(node);
    this.$validateMaxCount(node);
    this.$validatePrecludes(node);
  };
  this.$validateLocation = function(node) {
    if (!_.contains(this.$at, node.parent.name)) {
      throwForNode(node, new Error(
          "The " + node.name + " directive can't be used here"));
    }
  };
  this.$validateAndTransformArgs = function(node) {
    var argc = node.args.length;
    if (argc < this.$minParams || argc > this.$maxParams) {
      var expected = (this.$minParams === this.$maxParams) ? 
          this.$minParams :
          util.format("%d to %d", this.$minParams, this.$maxParams);
      var fewOrMany = argc < this.$minParams ? "few" : "many";
      var message = util.format('"%s" directive had too %s arguments; ', 
          node.name, fewOrMany);
      message += util.format('expected %s, found %d', expected, argc);
      throwForNode(node, new Error(message));
    }

    var paramsLeft = _.clone(this.$params);
    var typedArgs = map.create();
    _.each(node.args, function(arg) {
      var param = paramsLeft[0];
      if (!param.vararg) {
        paramsLeft.shift();
        typedArgs[param.name] = param.convert(arg);
      } else {
        if (!typedArgs[param.name])
          typedArgs[param.name] = [];
        typedArgs[param.name].push(param.convert(arg));
      }
    });
    _.each(paramsLeft, function(param) {
      // Apply default values, if any
      if (param.optional && param.hasDefaultValue) {
        typedArgs[param.name] = param.defaultValue;
      }
    });
    node.values = typedArgs;
  };
  this.$validateMaxCount = function(node) {
    var siblings = node.parent.children;

    if (this.$maxcount > siblings.length)
      return;

    var count = 0;
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i].name === node.name)
        count++;
      if (siblings[i] === node)
        break;
    }
    if (count > this.$maxcount) {
      throwForNode(node, new Error(
          util.format('%s directive appears too many times', node.name)));
    }
  };
  this.$validatePrecludes = function(node) {
    _.each(this.$precludes, function(precluded) {
      if (node.parent.getOne(precluded, false)) {
        throwForNode(node.parent, new Error(
            util.format('%s and %s directives are mutually exclusive',
                node.name, precluded)));
      }
    });
  };
}).call(ConfigSchemaRule.prototype);

exports.ConfigSchemaParam = ConfigSchemaParam;
function ConfigSchemaParam(paramNode) {
  assert.equal(paramNode.name, 'param');
  if (paramNode.args.length < 3)
    throwForNode(paramNode, new Error("Invalid schema specification"));
  this.type = paramNode.args[0];
  this.name = paramNode.args[1].replace(/^\[?([^[\].]+)\]?(...)?$/, '$1');
  this.desc = paramNode.args[2];
  this.optional = /^\[/.test(paramNode.args[1]);
  this.vararg = /\.{3}$/.test(paramNode.args[1]);
  this.required = !this.optional && !this.vararg;

  this.convert = ConfigTypes[this.type];
  if (!this.convert)
    throwForNode(paramNode,
        new Error('Unknown type "' + this.type + '". ' + 
            'Available types are ' + _.keys(ConfigTypes).join(', ')));

  // Default value
  if (paramNode.args.length > 3) {
    if (!this.optional)
      throwForNode(paramNode,
          new Error('Only optional parameters can have default values'));

    try {
      this.defaultValue = this.convert(paramNode.args[3]);
      this.hasDefaultValue = true;
    } catch (err) {
      throwForNode(paramNode, err);
    }
  }
}

var ConfigTypes = exports.ConfigTypes = {
  Boolean: ToBoolean,
  Integer: ToInteger,
  Float: ToFloat,
  String: _.identity
};

function ToBoolean(s) {
  if (/^(true|yes|on)$/im.test(s))
    return true;
  else if (/^(false|no|off)$/im.test(s))
    return false;
  throw new Error('"' + s + '" is not a valid Boolean value');
}

function ToInteger(s) {
  if (/^(0[x])[0-9a-f]+$/im.test(s))
    return parseInt(s);
  if (/^-?\d+$/m.test(s))
    return parseInt(s);
  throw new Error('"' + s + '" is not a valid Integer value');
}

function ToFloat(s) {
  // .0, 0., 0.0, but not .
  if (/^(\d*\.\d+)|(\d+\.?\d*)$/.test(s))
    return parseFloat(s);
  throw new Error('"' + s + '" is not a valid Float value');
}

exports.throwForNode = throwForNode;
function throwForNode(node, err) {
  assert(typeof err.message !== 'undefined');
  if (node.position)
    err.message += ' (' + node.position.toString() + ')';
  throw err;
}
