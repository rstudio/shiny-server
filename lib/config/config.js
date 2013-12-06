/*
 * config.js
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
var Q = require('q');
var _ = require('underscore');
var parser = require('./parser');
var schema = require('./schema');

exports.read_p = read_p;
/**
 * Reads the given config file. The returned promise resolves to the ConfigNode
 * object at the root of the config file.
 *
 * @param {String} path File path for the config file.
 * @returns {Promise} Promise that resolves to ConfigNode.
 */
function read_p(path, schemaPath) {
  return Q.nfcall(fs.readFile, path, 'utf8')
  .then(function(cdata) {
    return Q.nfcall(fs.readFile, schemaPath, 'utf8')
    .then(function(sdata) {
      return schema.applySchema(parse(cdata, path), parse(sdata, schemaPath));
    });
  });
}

/**
 * Reads the given config file.
 *
 * @param {String} path File path for the config file.
 * @returns {ConfigNode} The root ConfigNode.
 */
exports.readSync = readSync;
function readSync(path, schemaPath) {
  var configData = parse(fs.readFileSync(path, 'utf8'), path);
  var schemaData = parse(fs.readFileSync(schemaPath, 'utf8'), schemaPath);
  return schema.applySchema(configData, schemaData);
}

exports.parse = parse;
function parse(data, pathHint) {
  var root = new parser.ConfigParser(data, pathHint).parse();
  return directiveToConfig(root, null);
}

function directiveToConfig(directive, parent) {
  var depth = parent ? parent.depth + 1 : 0;
  var node = new ConfigNode(parent, directive.getName(), directive.getArgs(),
      directive.getPosition(), depth);
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
function ConfigNode(parent, name, args, position, depth) {
  this.parent = parent;
  this.name = name;
  this.args = args;
  this.values = null;
  this.position = position;
  this.depth = depth;
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
   * Convenience function that behaves the same as
   * getOne(criteria, [inherit]).values
   * except in the case that getOne finds nothing (or its values field is
   * falsy), in which case an empty object is returned.
   */
  this.getValues = function(criteria, inherit) {
    if (arguments.length < 2 || typeof inherit === 'undefined')
      inherit = true;

    var node = this.getOne(criteria, inherit);
    return (node && node.values) ? node.values : {};
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
  this.search = function(criteria, includeSelf, postOrder) {
    var predicate = this.$makePredicate(criteria);

    var results = [];
    if (includeSelf && !postOrder && predicate(this))
      results.push(this);
    results = _.flatten(results.concat(
      _.map(this.children, function(child) {
        return child.search(predicate, true, postOrder);
      })
    ));
    if (includeSelf && postOrder && predicate(this))
      results.push(this);
    return results;
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
