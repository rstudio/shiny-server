/*
 * worker-entry.js
 *
 * Copyright (C) 2009-17 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
const crypto = require("crypto");
var EventEmitter = require('events');
require('../core/log');

/**
 * An entry in the worker table in Scheduler. This provides:
 * 
 * 1. A set of counters, for how many active http and sockjs connections have
 *    been assigned to this worker process.
 *
 *    a. acquire/release methods for incrementing/decrementing the connection
 *       count.
 *
 * 2. The (promise to the) AppWorkerHandle object for this process. It is
 *    possible for the process to be launched but fail during startup (i.e. it
 *    never starts listening for connections on the expected port before either
 *    exiting or timing out (app_init_timeout)), in which case the promise will
 *    be rejected.
 *
 * 3. An "idletimeout" event which will fire after the worker has been unused
 *    for idleTimeout milliseconds (specified by app_idle_timeout).
 *
 * 4. An id field which uniquely identifies this worker.
 */
class WorkerEntry extends EventEmitter {
  constructor(promise, data, idleTimeout) {
    super();
    // Because appSpec will no longer uniquely identify a worker, assign a
    // random ID to each worker for addressing purposes.
    this.id = crypto.randomBytes(8).toString('hex');
    this.promise = promise;
    this.data = data;
    this.data.httpConn = 0;
    this.data.sockConn = 0;
    this.idleTimeout = idleTimeout;
    // If true, the scheduler has removed this entry from the
    // worker table already and it can no longer be used.
    this.closed = false;
  }

  acquire(connType) {
    if (connType === "http") {
      this.data.httpConn++;
    } else if (connType === "sock") {
      this.data.sockConn++;
    } else {
      throw Error("Unrecognized type to be acquired: \"" + connType + "\"");
    }

    logger.trace("Worker #" + this.id + " acquiring " + connType + " port. " + 
      this.data.httpConn + " open HTTP connection(s), " +
      this.data.sockConn + " open WebSocket connection(s).");

    // clear the timer to ensure this process doesn't get destroyed.
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getAppWorkerHandle_p() {
    return this.promise;
  }

  release(connType) {
    if (this.closed) {
      // Must have already been deleted. Don't need to do any work.
      return;
    }

    if (connType == "http") {
      this.data.httpConn--;
      this.data.httpConn = Math.max(0, this.data.httpConn);
    } else if (connType == "sock") {
      this.data.sockConn--;
      this.data.sockConn = Math.max(0, this.data.sockConn);
    } else {
      throw Error("Unrecognized type to be released: \"" + connType + "\"");
    }

    logger.trace("Worker #" + this.id + " releasing " + connType + " port. " + 
      this.data.httpConn + " open HTTP connection(s), " +
      this.data.sockConn + " open WebSocket connection(s).")

    this.startIdleTimer();
  }

  startIdleTimer() {
    if (this.data.sockConn + this.data.httpConn === 0) {
      if (this.idleTimeout > 0){
        logger.trace("No clients connected to worker #" + this.id + ". Starting timer");
        global.clearTimeout(this.timer);
        this.timer = global.setTimeout(() => {
          this.emit("idletimeout");
        }, this.idleTimeout);
      }
      else {
        logger.trace("No clients connected to worker #" + this.id + ", but refusing to reap due to non-positive idle_timeout.");
      }
    }    
  }

  close() {
    this.closed = true;
  }
}
module.exports = WorkerEntry;
