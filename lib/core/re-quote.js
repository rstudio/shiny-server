/*
 * re-quote.js
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

 module.exports = function(str){
  // List derived from  http://stackoverflow.com/questions/399078/what-special-characters-must-be-escaped-in-regular-expressions
  return str.replace(/[.\^$*+?()[{\\|\-\]]/g, '\\$&');
 }