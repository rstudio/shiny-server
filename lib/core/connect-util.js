/*
 * connect-util.js
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
var url = require('url');

exports.filterByRegex = filterByRegex;
function filterByRegex(pathRegex, app) {
  return function(req, res, next) {
    var parsedUrl = url.parse(req.url);
    if (pathRegex.test(parsedUrl.path)) {
      app(req, res, next);
    } else {
      next();
    }
  };
}