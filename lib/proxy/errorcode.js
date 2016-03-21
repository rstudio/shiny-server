/*
 * errorcode.js
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

/**

We use WebSocket/SockJS close codes to convey to shiny-server-client
and post-0.13 versions of Shiny whether they should attempt to
reconnect to existing sessions or transparently start new sessions,
respectively.

|-----------------------------------------------------|
|              | Restart           | No restart       |
|-----------------------------------------------------|
| Reconnect    | 46xx or !wasClean | (never)          |
| No reconnect | 47xx              | 45xx or wasClean |
|-----------------------------------------------------|

46xx - Disruption; attempt to reconnect and/or restart
Examples of 46xx:
- Any kind of transient networking problem (!wasClean)

47xx - Bad session; don't attempt to reconnect, but can restart
Examples of 47xx:
- Server restart
- Protocol violation, or any other unexpected state

45xx - Normal, clean closure; don't attempt to reconnect or restart
Examples of 45xx:
- Idle connection timeout
- Process exit with error (don't automatically restart)

**/

module.exports = {
  // It is more important than the baseNum values be *unique*
  // and *stable between releases* than for them to be in a
  // logical grouping/order. (i.e. please don't insert a new
  // code in the middle of the list and renumber all the
  // subsequent codes).
  ACCESS_DENIED    : closureCode(0, false, false),
  OUT_OF_CAPACITY  : closureCode(1, false, false),
  SHUTTING_DOWN    : closureCode(2, false, true),
  APP_EXIT         : closureCode(3, false, false),
  BAD_PROTOCOL     : closureCode(4, false, true),
  BAD_IDENTIFIER   : closureCode(5, false, true),
  RETIRED          : closureCode(6, false, false)
};

function closureCode(baseNum, allowReconnect, allowRestart) {
  if (baseNum < 0 || baseNum > 99) {
    logger.warn("Invalid closure code base number: " + baseNum);
    baseNum = Math.abs(baseNum) % 100;
  }

  if (!allowReconnect && !allowRestart) {
    return baseNum + 4500;
  } else if (allowReconnect && allowRestart) {
    return baseNum + 4600;
  } else if (!allowReconnect && allowRestart) {
    return baseNum + 4700;
  } else {
    logger.warn("Invalid closure code flag combination (" +
      allowReconnect + ", " + allowRestart + ")"
    );
    return 4000 + baseNum;
  }
}
