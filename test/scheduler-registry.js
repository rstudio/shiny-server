/*
 * test/scheduler-registry.js
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

describe('SchedulerRegistry', function(){
  describe('#getWorker_p', function(){
    it('Creates a new scheduler on initial request.'),
    it('Doesn\'t create a new scheduler for a repeat request.'),
    it('Creates a new scheduler for a new AppSpec'),
    it('Properly considers local app config when creating a new scheduler.')
  })
})
