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
const EventEmitter = require('events');
const log = require('../core/log');

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
    // See comment for this.pendingReleaseTimers below.
    this.data.pendingConn = 0;
    this.idleTimeout = idleTimeout;
    // If true, the scheduler has removed this entry from the
    // worker table already and it can no longer be used.
    this.closed = false;

    // The purpose of pendingConn and pendingReleaseTimers requires some
    // explanation. When we receive an HTTP request for an app page (as
    // opposed to an HTTP request for a JS/CSS asset or for a subapp page)
    // or an .Rmd document, we know that if the request is successful it
    // is a pretty safe bet that a new SockJS connection will soon be on
    // the way. Therefore, we should essentially "reserve" a spot for that
    // connection, and that's what pendingConn is; we should increment it
    // when an app page or Rmd is loaded, and decrement it when a SockJS
    // connection arrives. (Note that it's just a simple counter, there's
    // matching up of specific HTTP requests with corresponding SockJS
    // connections.)
    //
    // On the other hand, it's not absolutely guaranteed that a SockJS
    // connection will actually arrive. There could be proxy or firewall
    // issues, or JS bugs. If a connection never arrives then pendingConn
    // is never decremented, and the worker can never be shut down. So
    // we maintain a FIFO queue of timers (pendingReleaseTimers) that will
    // decrement pendingConn after a reasonable delay. Each time a SockJS
    // connection arrives, we should not only decrement pendingConn, but
    // also kill the first (i.e. oldest) timer in the queue.
    //
    // One last thing. It may be an arbitrarily long time between when
    // the HTTP request for the app page/.Rmd document begins and ends.
    // During this period, we want to pre-emptively reserve a spot (i.e.
    // we need to increment pendingConn as request processing begins, not
    // ends) and if the request fails, then we immediately decrement
    // pendingConn and don't append a pendingReleaseTimers timer. If we
    // don't do this, then we may let lots and lots of app pages be
    // loaded when we couldn't possibly have the capacity to serve their
    // sessions; better to 503 immediately on the HTTP request.
    this.pendingReleaseTimers = [];
  }

  sessionCount() {
    return this.data.sockConn + this.data.pendingConn;
  }

  acquire(connType) {
    if (connType === "http") {
      this.data.httpConn++;
    } else if (connType === "sock") {
      this.data.sockConn++;
    } else if (connType === "pending") {
      this.data.pendingConn++;
    } else {
      throw Error("Unrecognized type to be acquired: \"" + connType + "\"");
    }

    logger.trace("Worker #" + this.id + " acquiring " + connType + " port. " + 
      this.data.httpConn + " HTTP, " +
      this.data.sockConn + " WebSocket, " +
      this.data.pendingConn + " pending.");

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

    if (connType === "http") {
      this.data.httpConn--;
      this.data.httpConn = Math.max(0, this.data.httpConn);
    } else if (connType === "sock") {
      this.data.sockConn--;
      this.data.sockConn = Math.max(0, this.data.sockConn);
    } else if (connType === "pending") {
      if (this.data.pendingConn <= 0) {
        logger.trace("Worker #" + this.id + " released pending but none " +
            "were available.");
        return;
      }
      this.data.pendingConn--;
    } else {
      throw Error("Unrecognized type to be released: \"" + connType + "\"");
    }

    logger.trace("Worker #" + this.id + " releasing " + connType + " port. " + 
      this.data.httpConn + " HTTP, " +
      this.data.sockConn + " WebSocket, " +
      this.data.pendingConn + " pending.");

    this.startIdleTimer();
  }

  startIdleTimer() {
    if (this.data.sockConn + this.data.httpConn + this.data.pendingConn === 0) {
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

  // Create a new timer to call release("pending") after a delay, and
  // push the timer onto a list. See also shiftPendingReleaseTimer.
  pushPendingReleaseTimer(timeout) {
    const timerId = global.setTimeout(() => {
      if (this.pendingReleaseTimers.length > 0 && this.pendingReleaseTimers[0] === timerId) {
        this.pendingReleaseTimers.shift();
      } else {
        logger.warn("Surprisingly, active pending release timer wasn't on the front of the queue");
      }

      if (this.closed) return;

      logger.trace("Worker #" + this.id + " pending session timer expired");
      this.release("pending");
    }, timeout);
    this.pendingReleaseTimers.push(timerId);
  }

  // Cancel the oldest timer in the pendingReleaseTimers list.
  // Returns true if a pendingReleaseTimer was in the queue.
  shiftPendingReleaseTimer() {
    if (this.pendingReleaseTimers.length > 0) {
      global.clearTimeout(this.pendingReleaseTimers.shift());
      return true;
    }
    return false;
  }

  close() {
    this.closed = true;
    while (this.shiftPendingReleaseTimer()) {
      // intentionally empty
    }
  }
}
module.exports = WorkerEntry;
