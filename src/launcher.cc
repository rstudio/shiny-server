/*
 * launcher.cc
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
#include <unistd.h>
#include <sys/param.h>
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <libgen.h>
#include <string.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <string>
#include <vector>
#include <algorithm>

#include "launcher.h"

// The purpose of this executable is to provide a clean entry point for
// shiny-server, that is capable of running either daemonized or not.

int findBaseDir(std::string* shinyServerPath);

int main(int argc, char **argv) {

  // If the caller requested daemonizing, do it.
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--daemonize") == 0) {
      daemon(1, 0);
      break;
    }
  }


  std::string shinyServerPath;
  int result = findBaseDir(&shinyServerPath);
  if (result != 0)
    return result;

  std::string nodePath = shinyServerPath + "/ext/node/bin/shiny-server";
  std::string mainPath = shinyServerPath + "/lib/main.js";

  // Two extra args: one for mainPath, one for NULL terminator
  char** newargs = new char*[argc + 2];
  newargs[0] = strdup(nodePath.c_str());
  newargs[1] = strdup(mainPath.c_str());
  for (int i = 0; i < argc - 1; i++) {
    newargs[i + 2] = argv[i + 1];
  }
  newargs[argc + 1] = NULL;

  execv(nodePath.c_str(), newargs);
 
  // This will actually never get called.
  free(newargs[0]);
  free(newargs[1]);
  delete newargs;

  return 0;
}

// Determines the base dir of the shiny-server instance that's being invoked,
// by calling readlink on /proc/<pid>/exe.
int findBaseDir(std::string* shinyServerPath) {

  char execPath[MAXPATHLEN + 1];
  int cn = snprintf(execPath, MAXPATHLEN + 1, "/proc/%d/exe", getpid());
  if (cn < 0 || cn > MAXPATHLEN) {
    // Not expected
    return 2;
  }

  struct stat execStat;
  if (lstat(execPath, &execStat)) {
    if (errno == ENOENT)
      fprintf(stderr, "/proc/%d/exe doesn't exist--got Linux?\n", getpid());
    else
      fprintf(stderr, "Fatal error calling lstat: %d\n", errno);
    return 1;
  }

  if (!S_ISLNK(execStat.st_mode)) {
    fprintf(stderr, "/proc/%d/exe was not a symlink\n", getpid());
    return 1;
  }

  if (execStat.st_size > MAXPATHLEN) {
    fprintf(stderr, "Link resolved to an unexpectedly long path\n");
    return 1;
  }
  ssize_t charsNeeded = execStat.st_size > 0 ? execStat.st_size : MAXPATHLEN;

  std::vector<char> execBuf(charsNeeded + 1, 0);
  ssize_t cb = readlink(execPath, &execBuf[0], execBuf.size());
  if (cb < 0) {
    fprintf(stderr, "Fatal error calling readlink: %d\n", errno);
    return 1;
  }
  std::copy(execBuf.begin(), execBuf.begin() + cb, execPath);
  execPath[cb] = '\0';

  *shinyServerPath = dirname(dirname(execPath));

  return 0;
}
