var _ = require('underscore');

/*
 * map.js
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
exports.create = create;
/**
 * Create a map (similar to {} but without the problems described in
 * http://www.devthought.com/2012/01/18/an-object-is-not-a-hash/).
 */
function create() {
  return Object.create(null);
}

exports.compact = compact;
/**
 * Return a copy of object x with null or undefined "own" properties removed.
 */
function compact(x) {
  function shouldDrop(key) {
    return typeof(x[key]) === 'undefined' || x[key] === null;
  }
  return _.omit(x, _.filter(_.keys(x), shouldDrop))
}