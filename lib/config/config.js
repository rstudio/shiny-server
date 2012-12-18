var fs = require('fs');
var util = require('util');
var Q = require('q');
var _ = require('underscore');
var parser = require('./parser');


exports.read_p = read_p;
/**
 * Reads the given config file. The returned promise resolves to the ConfigNode
 * object at the root of the config file.
 *
 * @param {String} path File path for the config file.
 * @returns {Promise} Promise that resolves to ConfigNode.
 */
function read_p(path) {
  return Q.nfcall(fs.readFile, path, 'utf8')
  .then(function(data) {
    return parseConfigData(data);
  });
}

/**
 * Reads the given config file.
 *
 * @param {String} path File path for the config file.
 * @returns {ConfigNode} The root ConfigNode.
 */
exports.readSync = readSync;
function readSync(path) {
  return parseConfigData(fs.readFileSync(path, 'utf8'));
}

exports.parseConfigData = parseConfigData;
function parseConfigData(data) {
  var root = new parser.ConfigParser(data).parse();
  return directiveToConfig(root, null);
}

function directiveToConfig(directive, parent) {
  var node = new ConfigNode(parent, directive.getName(), directive.getArgs(),
      directive.getPosition());
  node.children = _.map(directive.children, function(child) {
    return directiveToConfig(child, node);
  });
  return node;
};

exports.ConfigNode = ConfigNode;
/**
 * A ConfigNode object represents a node in the config tree. Each non-root node
 * has a parent node, a name, and zero or more argument strings. Each node has
 * zero or more children.
 *
 * Examples of simple nodes:
 * user jcheng;
 * autouser on;
 *
 * Examples of nodes with children:
 * location /users {
 *   autouser on;
 * }
 *
 * Nested nodes:
 * server {
 *   port 8080;
 *   location / {
 *     appdir /var/www-shiny/;
 *   }
 * }
 *
 * @constructor
 */
function ConfigNode(parent, name, args, position) {
  this.parent = parent;
  this.name = name;
  this.args = args;
  this.position = position;
  this.children = [];
}
(function() {
  /**
   * Return a single node with the given criteria, if it exists. This node's
   * children are searched first. If no match is found and inherit is true,
   * then recurse to the parent, if any.
   *
   * @param {*} criteria The node criteria. See search().
   * @param {Boolean} [inherit] Whether to search ancestor nodes too.
   * @returns {ConfigNode} A matching ConfigNode object, or null.
   */
  this.getOne = function(criteria, inherit) {
    if (arguments.length < 2 || typeof inherit === 'undefined')
      inherit = true;

    var predicate = this.$makePredicate(criteria);

    var result = _.find(this.children, predicate);
    if (result)
      return result;
    if (inherit && this.parent)
      return this.parent.getOne(predicate, true);
    else
      return null;
  };

  /**
   * Return all the nodes that match the given criteria AND are direct children
   * of this config node.
   *
   * @param {*} criteria The node criteria. See search().
   * @returns {Array} Array of matching ConfigNode objects.
   */
  this.getAll = function(criteria) {
    return _.filter(this.children, this.$makePredicate(criteria));
  };

  /**
   * Convenience function that finds a node using the same behavior as getOne()
   * and, if it exists and has one or more arguments, returns the first arg.
   * If no node is found or it has no arguments then the defaultValue is
   * returned.
   *
   * @param {*} criteria The node criteria. See search().
   * @param {String} [defaultValue] Value to return if no suitable match is found.
   * @param {boolean} [inherit] True if ancestor nodes should be included when
   *   finding a matching node.
   * @returns {String} The string value that was requested, or defaultValue.
   */
  this.getValue = function(criteria, defaultValue, inherit) {
    if (arguments.length < 3 || typeof inherit === 'undefined')
      inherit = true;
    var match = this.getOne(criteria, inherit);
    if (!match)
      return defaultValue;
    if (match.args.length < 1)
      return defaultValue;
    return match.args[0];
  };

  /**
   * Finds ALL nodes from here and all descendant nodes that match the
   * criteria. If includeSelf, then this node is itself eligible for inclusion
   * in the results (if it matches the criteria, that is).
   *
   * @param {*} criteria The criteria for searching. This can be one of several
   *   types:
   *   * true - Match all nodes
   *   * false - Match no nodes
   *   * String - Match all nodes whose name is === to this string
   *   * Function - Matches all nodes that this function maps to a truthy value
   *   * Regexp - Matches all nodes whose names test true for this regex
   * @param {boolean} includeSelf If false, this node will not be included in
   *   the results even if it matches the criteria.
   * @returns {Array} All the matching nodes (depth-first, preorder).
   */
  this.search = function(criteria, includeSelf) {
    var predicate = this.$makePredicate(criteria);

    var results = [];
    if (includeSelf && predicate(this))
      results.push(this);
    return _.reduce(
      _.map(this.children, function(child) {return child.search(predicate, true);}),
      function (memo, matches) {
        return memo.concat(matches);
      },
      results
    );
  };

  this.$makePredicate = function(criteria) {
    if (criteria === true)
      return function() { return true; };
    if (criteria === false)
      return function() { return false; };

    switch (typeof criteria) {
      case 'function':
        return criteria;
      case 'string':
        return function(node) { return node.name === criteria; };
      case 'object':
        return function(node) { return criteria.test(node.name); };
      default:
        throw new Error('Unexpected criteria type ' + (typeof criteria));
    }
  };
}).call(ConfigNode.prototype);


exports.validate = validate;
function validate(validationRoot, configRoot) {
  var rules = {};
  _.each(validationRoot.children, function(child) {
    rules[child.name] = new ConfigValidationRule(child);
  });

  _.each(configRoot.search(true, false), function(node) {
    var rule = rules[node.name];
    if (!rule)
      throwForNode(node, "Unknown directive " + node.name);
    rule.validate(node);
  });
}

function ConfigValidationRule(configNode) {
  this.$name = configNode.name;
  this.$at = _.map(configNode.getOne('at').args, function(arg) {
    return (arg === '$') ? null : arg;
  });
  this.$params = configNode.getAll('param');
  this.$minParams = _.reduce(this.$params, function(memo, p) {
    return memo + (/^\[.*]$/.test(p.args[1]) ? 0 : 1);
  }, 0);
  this.$maxParams = _.reduce(this.$params, function(memo, p) {
    return memo + (/\.{3}$/.test(p.args[1]) ? 1/0 : 1);
  }, 0);
}
(function() {
  this.validate = function(node) {
    this.$validateLocation(node);
    this.$validateArgs(node);
  };
  this.$validateArgs = function(node) {
    if (node.args.length < this.$minParams)
      throwForNode(node, new Error('"' + node.name + '" directive had too few arguments'));
    if (node.args.length > this.$maxParams) 
      throwForNode(node, new Error('"' + node.name + '" directive had too many arguments'));
    // TODO: Validate each arg
  };
  this.$validateLocation = function(node) {
    if (!_.contains(this.$at, node.parent.name)) {
      throwForNode(node, new Error("The " + node.name + " directive can't be used here"));
    }
  };
}).call(ConfigValidationRule.prototype);

function throwForNode(node, err) {
  if (node.position)
    err.message += ' (at line ' + node.position.line + ', column ' + node.position.col + ')';
  throw err;
}
