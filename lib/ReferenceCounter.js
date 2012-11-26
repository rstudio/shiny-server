//
// ReferenceCounter.js
//
// Copyright (C) 2009-12 by RStudio, Inc.
//
// This program is licensed to you under the terms of version 3 of the
// GNU Affero General Public License. This program is distributed WITHOUT
// ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
// AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
//

//  ReferenceCounter - reference counted object that executes a callback
//                     after a certain delay.
//
//  Underscores denote private properties and methods.
//
exports.createRefCounter = function(callback, delay){
   return new ReferenceCounter(callback, delay);

}
var ReferenceCounter = exports.ReferenceCounter = function(callback,delay){
   this._delay = delay;
   this._callback = callback;
   this._count = 0;
   this._timeoutId = null;
}

ReferenceCounter.prototype.start = function(){

   this._setTimeout();

   return this;
}

ReferenceCounter.prototype._clearTimeout = function(){
   if (this._timeoutId != null){
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
   }

   return this;
}

ReferenceCounter.prototype._setTimeout = function(delay){
   var self = this;
   this._clearTimeout();

   this._timeoutId = setTimeout( 
         function(){
            //console.log('refcount: calling callback');
            return self._callback();
         },
         (delay === undefined)? this._delay : delay
   );

   return this;
}

ReferenceCounter.prototype.increment = function(){
   this._clearTimeout();
   this._count++;

   return this;
}

ReferenceCounter.prototype.decrement = function(){

   this._count--;

   if (this._count <= 0){
      this._count = 0;
      this._setTimeout();
   }

   return this;
}

ReferenceCounter.prototype.delayTimeoutBy = function(delay){

   // No-op if there are still references to this object
   if (this._count > 0) return this;

   this._setTimeout(delay);

   return this;
}
