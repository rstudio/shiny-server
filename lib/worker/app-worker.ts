/*
 * app-worker.js
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
 * An AppWorker is responsible for:
 *
 * - Launching a Shiny application with the proper user/group permissions
 * - Ensuring that stderr is written to the specified path
 * - Returning a promise that resolves when the worker process exits
 */

var child_process = require("child_process");
import * as fs from "fs";
import * as fs_promises from "fs/promises";
import { Endpoint } from "../transport/tcp";
import { AppSpec } from "./app-spec";
var path = require("path");
var util = require("util");
var bash = require("bash");
import Q = require("q");
var _ = require("underscore");
var map = require("../core/map");
var paths = require("../core/paths");
var permissions = require("../core/permissions");
import split = require("split");
import { ChildProcess } from "child_process";
var posix = require("../../build/Release/posix");

var rprog = process.env.R || "R";
var scriptPath = paths.projectFile("R/SockJSAdapter.R");

const STDERR_PASSTHROUGH = !!process.env["SHINY_LOG_STDERR"];

interface ExitStatus {
  code: number;
  signal: string;
}

interface Passwd {
  uid: number;
  gid: number;
  home?: string;
}

interface ShinyInput {
  appDir: string;
  port: string;
  gaTrackingId?: string;
  sharedSecret: string;
  shinyServerVersion: string;
  workerId: string;
  mode: string;
  pandocPath: string;
  logFilePath?: string;
  disableProtocols: string;
  reconnect: boolean;
  sanitizeErrors: boolean;
  bookmarkStateDir?: string;
}

interface ShinyOutput {
  pid: number;
  versions: {
    r: string;
    shiny: string;
    rmarkdown: string;
    knitr: string;
  };
}

function exists(path: string): Q.Promise<boolean> {
  return Q.resolve(fs_promises.access(path)).then(
    () => true,
    () => false
  );
}

function spawnUserLog_p(
  pw: Passwd,
  appSpec: AppSpec,
  endpoint: Endpoint,
  logFilePath: string,
  workerId: string
): Q.Promise<AppWorker> {
  var prom = Q.defer<AppWorker>();

  let mode = appSpec.settings.appDefaults.logFileMode;

  // Create the log file (and directory if needed)
  var rm = child_process.spawn(
    paths.projectFile("scripts/create-log.sh"),
    [logFilePath, mode],
    { uid: pw.uid, gid: pw.gid }
  );
  rm.on("close", function (code: number) {
    if (code != 0) {
      var err = "Failed to create log file: " + logFilePath + ", " + mode;
      logger.error(err);
      prom.reject(err);
      return;
    }

    // Have R do the logging
    var worker = new AppWorker(
      appSpec,
      endpoint,
      logFilePath,
      workerId,
      pw.home
    );
    prom.resolve(worker);
  });

  return prom.promise;
}

/**
 * Begins launching the worker; returns a promise that resolves when
 * the worker is constructed (doesn't necessarily mean the process has
 * actually begun running though).
 *
 * @param {AppSpec} appSpec - Contains the basic details about the app to
 *   launch
 * @param pw - the user info, a result of `posix.getpwnam()`
 * @param {Endpoint} endpoint - The endpoint that the Shiny app should
 *   listen on.
 * @param {String} logFilePath - The file path to write stderr to.
 */
function launchWorker_p(
  appSpec: AppSpec,
  pw: Passwd,
  endpoint: Endpoint,
  logFilePath: string,
  workerId: string
): Q.Promise<AppWorker> {
  if (!pw)
    return Q.reject(new Error("User " + appSpec.runAs + " does not exist"));

  if (!pw.home)
    return Q.reject(
      new Error("User " + appSpec.runAs + " does not have a home directory")
    );

  if (!appSpec.appDir) return Q.reject(new Error("No app directory specified"));

  return exists(appSpec.appDir).then(function (exists): Q.Promise<AppWorker> {
    // TODO: does this need to be as user?
    if (!exists) {
      var err = new Error("App dir " + appSpec.appDir + " does not exist");
      (err as any).code = "ENOTFOUND";
      throw err;
    }

    if (!appSpec.logAsUser) {
      var logDir = path.dirname(logFilePath);
      // Ensure that the log directory exists.
      try {
        fs.mkdirSync(logDir, "755");
        fs.chownSync(logDir, pw.uid, pw.gid);
      } catch (ex) {
        try {
          var stat = fs.statSync(logDir);
          if (!stat.isDirectory()) {
            logger.error("Log directory existed, was a file: " + logDir);
            logDir = null;
          }
        } catch (ex2) {
          logger.error("Log directory creation failed: " + ex2.message);
          logDir = null;
        }
      }

      let mode = appSpec.settings.appDefaults.logFileMode;

      // Manage the log file as root
      // Open the log file asynchronously, then create the worker
      return Q.resolve(fs_promises.open(logFilePath, "a", mode)).then(function (
        logStream: fs_promises.FileHandle
      ) {
        fs.fchown(logStream.fd, pw.uid, pw.gid, function (err) {
          if (err)
            logger.error(
              "Error attempting to change ownership of log file at " +
                logFilePath +
                ": " +
                err.message
            );
        });
        fs.fchmod(logStream.fd, mode, function (err) {
          if (err)
            logger.error(
              "Error attempting to change permissions on log file at " +
                logFilePath +
                ": " +
                err.message
            );
        });

        // We got a file descriptor and have chowned the file which is great, but
        // we actually want a writeStream for this file so we can handle async
        // writes more cleanly.
        var writeStream = fs.createWriteStream(null, {
          fd: logStream,
          flags: "w",
          mode: parseInt(mode, 8),
        });

        // If we have problems writing to writeStream, report it at most once.
        var warned = false;
        writeStream.on("error", function (err) {
          if (!warned) {
            warned = true;
            logger.warn("Error writing to log stream: ", err);
          }
        });

        // Create the worker; when it exits (or fails to start), close
        // the logStream.
        var worker = new AppWorker(
          appSpec,
          endpoint,
          writeStream,
          workerId,
          pw.home
        );

        return worker;
      });
    } else {
      return spawnUserLog_p(pw, appSpec, endpoint, logFilePath, workerId);
    }
  });
}
exports.launchWorker_p = launchWorker_p;

/**
 * Creates the top-level (system) bookmark state directory, then the user's
 * bookmark state directory, and then the app's bookmark state directory.
 */
function createBookmarkStateDirectory_p(
  bookmarkStateDir: string,
  username: string
): Q.Promise<void> {
  if (bookmarkStateDir === null || bookmarkStateDir === "") {
    return Q();
  }

  // Capitalize first character
  function capFirst(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function createDir_p(
    dir: string,
    mode: string,
    username?: string,
    label?: string
  ): Q.Promise<void> {
    if (label) {
      label = label + " ";
    } else {
      label = "";
    }

    return Q.nfcall(fs.mkdir, dir, mode)
      .then(function () {
        logger.info(
          capFirst("created " + label + "bookmark state directory: " + dir)
        );
      })
      .then(function () {
        // chown if username was supplied
        if (typeof username === "string") {
          var pw = posix.getpwnam(username);
          return Q.nfcall(fs.chown, dir, pw.uid, pw.gid);
        }
      })
      .fail(async function (err: Error) {
        try {
          const stat = await fs_promises.stat(dir);
          if (!stat.isDirectory()) {
            logger.error(
              capFirst(
                label + "bookmark state directory existed, was a file: " + dir
              )
            );
          }
          // We couldn't create it because it already existed--that's fine.
          return;
        } catch {}

        logger.error(
          capFirst(label + "bookmark state directory creation failed: " + dir)
        );
        throw err;
      });
  }

  var userBookmarkStateDir = path.join(bookmarkStateDir, username);

  return createDir_p(bookmarkStateDir, "711")
    .then(function () {
      return createDir_p(userBookmarkStateDir, "700", username, "user");
    })
    .fail(function (err) {
      throw err;
    });
}

/**
 * An AppWorker models a single R process that is running a Shiny app.
 *
 * @constructor
 * @param {AppSpec} appSpec - Contains the basic details about the app to
 *   launch
 * @param {String} endpoint - The transport endpoint the app should listen on
 * @param {Stream} logStream - The stream to dump stderr to, or the path to
 *   the file where the logging should happen. If just the path, pass it in
 *   to the R proc to have R handle the logging itself.
 */
class AppWorker {
  $dfEnded: Q.Deferred<ExitStatus>;
  exited: boolean;
  $pid: number;
  $proc: ChildProcess;

  constructor(
    appSpec: AppSpec,
    endpoint: Endpoint,
    logStream: fs.WriteStream | string,
    workerId: string,
    home: string
  ) {
    this.$dfEnded = Q.defer();
    var self = this;

    this.exited = false;
    this.$pid = null;

    // Spawn worker process via su, to ensure proper setgid, initgroups, setuid,
    // etc. are called correctly.
    //
    // We use stdin to tell SockJSAdapter what app dir, port, etc. to use, so
    // that non-root users on the system can't use ps to discover what apps are
    // available and on what ports.

    logger.trace("Starting R");

    try {
      // Run R
      var executable: string, args: Array<string>;
      var switchUser =
        appSpec.runAs !== null &&
        permissions.getProcessUser() !== appSpec.runAs;

      if (typeof appSpec.runAs === "object") {
        throw new Error(
          "Assertion error: appSpec.runAs should be a string or null at this point"
        );
      }

      if (!switchUser && permissions.isSuperuser())
        throw new Error("Aborting attempt to launch R process as root");

      if (switchUser) {
        executable = "su";
        args = [
          "-p",
          "--",
          appSpec.runAs,
          "-c",
          "cd " +
            bash.escape(appSpec.appDir) +
            " && " +
            bash.escape(rprog) +
            " --no-save --slave -f " +
            bash.escape(scriptPath),
        ];

        if (process.platform === "linux") {
          // -s option not supported by OS X (or FreeBSD, or Sun)
          args = ["-s", "/bin/bash", "--login"].concat(args);
        } else {
          // Other platforms don't clear out env vars, so simulate user env
          args.unshift("-");
        }
      } else {
        executable = rprog;
        args = ["--no-save", "--slave", "-f", scriptPath];
      }

      // The file where R should send stderr, or empty if it should leave it alone.
      var logFile = "";
      if (typeof logStream === "string") {
        logFile = logStream;
        logStream = "ignore"; // Tell the child process to drop stderr
        logger.trace("Asking R to send stderr to " + logFile);
      }

      const shinyInput = JSON.stringify(
        createShinyInput(appSpec, endpoint, workerId, logFile)
      ) + "\n";

      var self = this;

      Q.nfcall(fs.stat, appSpec.appDir)
        .then(function (stat: fs.Stats) {
          if (!stat.isDirectory()) {
            throw new Error(
              "Trying to launch an application that is not a directory: " +
                appSpec.appDir
            );
          }

          return createBookmarkStateDirectory_p(
            appSpec.settings.appDefaults.bookmarkStateDir,
            appSpec.runAs as string
          );
        })
        .then(function () {
          self.$proc = child_process.spawn(executable, args, {
            stdio: ["pipe", "pipe", "pipe"],
            cwd: appSpec.appDir,
            env: map.compact({
              HOME: home,
              LANG: process.env["LANG"],
              PATH: process.env["PATH"],
            }),
            detached: true, // So that we can send SIGINT not just to su but to the
            // R process that it spawns as well
          });
          self.$proc.on("exit", function (code: number, signal: string) {
            self.exited = true;
            self.$dfEnded.resolve({ code: code, signal: signal });
          });
          self.$proc.stdin.on("error", function () {
            logger.warn(
              "Unable to write to Shiny process. Attempting to kill it."
            );
            self.kill();
          });
          self.$proc.stdin.end(shinyInput);
          var stdoutSplit = self.$proc.stdout.pipe(split());
          stdoutSplit.on("data", function stdoutSplitListener(line) {
            const match = line.match(/^shiny_launch_info: (.*)$/);
            if (match) {
              console.log(match[1])
              const shinyOutput: ShinyOutput = JSON.parse(match[1]) as ShinyOutput;
              self.$pid = shinyOutput.pid;
              logger.trace(`R process spawned with pid ${shinyOutput.pid}`);
              logger.trace(`R version: ${shinyOutput.versions.r}`);
              logger.trace(`Shiny version: ${shinyOutput.versions.shiny}`);
              logger.trace(`rmarkdown version: ${shinyOutput.versions.rmarkdown}`);
              logger.trace(`knitr version: ${shinyOutput.versions.knitr}`);
            } else if (line.match(/^==END==$/)) {
              stdoutSplit.off("data", stdoutSplitListener);
              logger.trace("Closing backchannel");
            }
          });
          self.$proc.stderr
            .on("error", function (e) {
              logger.error("Error on proc stderr: " + e);
            })
            .pipe(split())
            .on("data", function (line) {
              if (STDERR_PASSTHROUGH) {
                logger.info(`[${appSpec.appDir}:${self.$pid}] ${line}`);
              }
              // Ensure that we, not R, are supposed to be handling logging.
              if (typeof logStream !== "string") {
                logStream.write(line + "\n");
              }
            })
            .on("end", function () {
              if (typeof logStream !== "string") {
                logStream.end();
              }
            });
        })
        .fail(function (err) {
          // An error occured spawning the process, could be we tried to launch a file
          // instead of a directory.
          logger.warn(err.message);

          if (!self.$proc) {
            // We never got around to starting the process, so the normal code path
            // that closes logStream won't run.
            if (typeof logStream !== "string") {
              logStream.end();
            }
          }

          self.$dfEnded.resolve({ code: -1, signal: null });
        })
        .done();
    } catch (e) {
      logger.trace(e);
      this.$dfEnded.reject(e);
    }
  }

  /**
   * Returns a promise that is resolved when the process exits.
   * If the process terminated normally, code is the final exit
   * code of the process, otherwise null. If the process
   * terminated due to receipt of a signal, signal is the string
   * name of the signal, otherwise null.
   */
  getExit_p(): Q.Promise<ExitStatus> {
    return this.$dfEnded.promise;
  }

  isRunning() {
    return !this.exited;
  }

  /**
   * Attempts to kill the process using the signal provided by
   * sending a SIGINT signal to the R process; if the process
   * is still alive after a few seconds, we send SIGTERM.
   */
  kill(force = false) {
    var exitPromise = this.getExit_p();
    if (!exitPromise.isPending()) return;

    const signal = force ? "SIGTERM" : "SIGINT";

    var pid = this.$pid;
    logger.trace(`Sending ${signal} to ${pid}`);

    try {
      process.kill(pid, signal);

      if (!force) {
        var timerId = setTimeout(function () {
          logger.debug(
            `Process ${pid} did not exit on ${signal}; sending SIGTERM`
          );
          try {
            process.kill(pid, "SIGTERM");
          } catch (e) {
            logger.trace("Failure sending SIGTERM: " + e);
          }
        }, 20000); // TODO: Should this be configurable?
      }

      exitPromise
        .then(function () {
          clearTimeout(timerId);
        })
        .eat();
    } catch (e) {
      logger.trace(`Failure sending ${signal}: ` + e);
    }
  }
}

function createShinyInput(
  appSpec: AppSpec,
  endpoint: Endpoint,
  workerId: string,
  logFile?: string
): ShinyInput {
  // Set mode to either 'shiny' or 'rmd'
  var mode = "shiny";
  if (appSpec.settings && appSpec.settings.mode) {
    mode = appSpec.settings.mode;
  }

  return {
    appDir: appSpec.appDir,
    port: endpoint.getAppWorkerPort(),
    gaTrackingId: appSpec.settings.gaTrackingId ?? "",
    sharedSecret: endpoint.getSharedSecret(),
    shinyServerVersion: SHINY_SERVER_VERSION,
    workerId,
    mode,
    pandocPath: paths.projectFile("ext/pandoc"),
    logFilePath: logFile ?? "",
    disableProtocols: appSpec.settings.appDefaults.disableProtocols.join(","),
    reconnect: appSpec.settings.appDefaults.reconnect,
    sanitizeErrors: appSpec.settings.appDefaults.sanitizeErrors,
    bookmarkStateDir: appSpec.settings.appDefaults.bookmarkStateDir,
  };
}
