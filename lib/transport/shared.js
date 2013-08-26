/*
 * shared.js
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

var crypto = require('crypto');
var _ = require('underscore');

exports.BaseEndpoint = BaseEndpoint;
function BaseEndpoint() {
  // The purpose of this shared secret is to make a Shiny app only respond to
  // requests that come from the process that spawned it, rather than opening
  // it up to just anyone.
  this.$sharedSecret = crypto.randomBytes(16).toString('hex');
}

(function() {
  this.getSharedSecret = function() {
    return this.$sharedSecret;
  };
}).call(BaseEndpoint.prototype);
