"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
exports.launchWorker_p = void 0;
/**
 * An AppWorker is responsible for:
 *
 * - Launching a Shiny application with the proper user/group permissions
 * - Ensuring that stderr is written to the specified path
 * - Returning a promise that resolves when the worker process exits
 */
var child_process = require("child_process");
var fs = require("fs");
var fs_promises = require("fs/promises");
var path = require("path");
var bash = require("bash");
var Q = require("q");
var map = require("../core/map");
var paths = require("../core/paths");
var permissions = require("../core/permissions");
var split = require("split");
var posix = require("../../build/Release/posix");
var rprog = process.env.R || "R";
var scriptPath = paths.projectFile("R/SockJSAdapter.R");
var STDERR_PASSTHROUGH = !!process.env["SHINY_LOG_STDERR"];
function exists(path) {
    return __awaiter(this, void 0, void 0, function () {
        var ex_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, fs_promises.access(path)];
                case 1:
                    _a.sent();
                    return [2 /*return*/, true];
                case 2:
                    ex_1 = _a.sent();
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
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
function launchWorker_p(appSpec, pw, endpoint, logFilePath, workerId) {
    if (!pw)
        return Q.reject(new Error("User " + appSpec.runAs + " does not exist"));
    if (!pw.home)
        return Q.reject(new Error("User " + appSpec.runAs + " does not have a home directory"));
    if (!appSpec.appDir)
        return Q.reject(new Error("No app directory specified"));
    return Q.resolve(exists(appSpec.appDir)).then(function (exists) {
        return __awaiter(this, void 0, void 0, function () {
            var err, logStream, worker;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        // TODO: does this need to be as user?
                        if (!exists) {
                            err = new Error("App dir " + appSpec.appDir + " does not exist");
                            err.code = "ENOTFOUND";
                            throw err;
                        }
                        if (!!appSpec.settings.logAsUser) return [3 /*break*/, 2];
                        return [4 /*yield*/, createLogFile(pw, appSpec, logFilePath)];
                    case 1:
                        logStream = _a.sent();
                        return [3 /*break*/, 4];
                    case 2: return [4 /*yield*/, createLogFileAsUser(pw, appSpec, logFilePath)];
                    case 3:
                        logStream = _a.sent();
                        _a.label = 4;
                    case 4:
                        worker = new AppWorker(appSpec, endpoint, logStream, workerId, pw.home);
                        return [2 /*return*/, worker];
                }
            });
        });
    });
}
exports.launchWorker_p = launchWorker_p;
function createLogFileAsUser(pw, appSpec, logFilePath) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            logger.trace("Creating ".concat(logFilePath, " as user"));
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var mode = appSpec.settings.appDefaults.logFileMode;
                    // Create the log file (and directory if needed)
                    var rm = child_process.spawn(paths.projectFile("scripts/create-log.sh"), [logFilePath, mode], { uid: pw.uid, gid: pw.gid });
                    rm.on("close", function (code) {
                        if (code != 0) {
                            var err = "Failed to create log file: " + logFilePath + ", " + mode;
                            logger.error(err);
                            reject(err);
                        }
                        else {
                            resolve(logFilePath);
                        }
                    });
                })];
        });
    });
}
function createLogFile(pw, appSpec, logFilePath) {
    return __awaiter(this, void 0, void 0, function () {
        var logDir, stat, mode, fileHandle, ex_2, ex_3, writeStream, warned;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    logger.trace("Creating ".concat(logFilePath));
                    logDir = path.dirname(logFilePath);
                    // Ensure that the log directory exists.
                    try {
                        fs.mkdirSync(logDir, "755");
                        fs.chownSync(logDir, pw.uid, pw.gid);
                    }
                    catch (ex) {
                        try {
                            stat = fs.statSync(logDir);
                            if (!stat.isDirectory()) {
                                logger.error("Log directory existed, was a file: " + logDir);
                                logDir = null;
                            }
                        }
                        catch (ex2) {
                            logger.error("Log directory creation failed: " + ex2.message);
                            logDir = null;
                        }
                    }
                    mode = appSpec.settings.appDefaults.logFileMode;
                    return [4 /*yield*/, fs_promises.open(logFilePath, "a", mode)];
                case 1:
                    fileHandle = _a.sent();
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, fileHandle.chown(pw.uid, pw.gid)];
                case 3:
                    _a.sent();
                    return [3 /*break*/, 5];
                case 4:
                    ex_2 = _a.sent();
                    logger.error("Error attempting to change ownership of log file at ".concat(logFilePath, ": ").concat(ex_2.message));
                    return [3 /*break*/, 5];
                case 5:
                    _a.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, fileHandle.chmod(mode)];
                case 6:
                    _a.sent();
                    return [3 /*break*/, 8];
                case 7:
                    ex_3 = _a.sent();
                    logger.error("Error attempting to change permissions on log file at ".concat(logFilePath, ": ").concat(ex_3.message));
                    return [3 /*break*/, 8];
                case 8:
                    writeStream = fileHandle.createWriteStream();
                    warned = false;
                    writeStream.on("error", function (err) {
                        if (!warned) {
                            warned = true;
                            logger.warn("Error writing to log stream: ", err);
                        }
                    });
                    return [2 /*return*/, writeStream];
            }
        });
    });
}
/**
 * Creates the top-level (system) bookmark state directory, then the user's
 * bookmark state directory, and then the app's bookmark state directory.
 */
function createBookmarkStateDirectory(bookmarkStateDir, username) {
    return __awaiter(this, void 0, void 0, function () {
        function createDir(dir, mode, username, label) {
            return __awaiter(this, void 0, void 0, function () {
                var pw, ex_4, stat, _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            if (label) {
                                label = label + " ";
                            }
                            else {
                                label = "";
                            }
                            _b.label = 1;
                        case 1:
                            _b.trys.push([1, 5, , 10]);
                            return [4 /*yield*/, fs_promises.mkdir(dir, mode)];
                        case 2:
                            _b.sent();
                            logger.info("created ".concat(label, "bookmark state directory: ").concat(dir));
                            if (!(typeof username === "string")) return [3 /*break*/, 4];
                            pw = posix.getpwnam(username);
                            return [4 /*yield*/, fs_promises.chown(dir, pw.uid, pw.gid)];
                        case 3:
                            _b.sent();
                            _b.label = 4;
                        case 4: return [3 /*break*/, 10];
                        case 5:
                            ex_4 = _b.sent();
                            _b.label = 6;
                        case 6:
                            _b.trys.push([6, 8, , 9]);
                            return [4 /*yield*/, fs_promises.stat(dir)];
                        case 7:
                            stat = _b.sent();
                            if (!stat.isDirectory()) {
                                logger.error("".concat(label, "bookmark state directory existed, was a file: ").concat(dir));
                            }
                            // We couldn't create it because it already existed--that's fine.
                            return [2 /*return*/];
                        case 8:
                            _a = _b.sent();
                            return [3 /*break*/, 9];
                        case 9:
                            logger.error("Failed to create ".concat(label, "bookmark state directory: ").concat(dir));
                            throw ex_4;
                        case 10: return [2 /*return*/];
                    }
                });
            });
        }
        var userBookmarkStateDir;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (bookmarkStateDir === null || bookmarkStateDir === "") {
                        return [2 /*return*/];
                    }
                    userBookmarkStateDir = path.join(bookmarkStateDir, username);
                    return [4 /*yield*/, createDir(bookmarkStateDir, "711")];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, createDir(userBookmarkStateDir, "700", username, "user")];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
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
var AppWorker = /** @class */ (function () {
    function AppWorker(appSpec, endpoint, logStream, workerId, home) {
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
            var executable, args;
            var switchUser = appSpec.runAs !== null &&
                permissions.getProcessUser() !== appSpec.runAs;
            if (typeof appSpec.runAs === "object") {
                throw new Error("Assertion error: appSpec.runAs should be a string or null at this point");
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
                }
                else {
                    // Other platforms don't clear out env vars, so simulate user env
                    args.unshift("-");
                }
            }
            else {
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
            var shinyInput_1 = JSON.stringify(createShinyInput(appSpec, endpoint, workerId, logFile)) +
                "\n";
            var self = this;
            Q.nfcall(fs.stat, appSpec.appDir)
                .then(function (stat) {
                if (!stat.isDirectory()) {
                    throw new Error("Trying to launch an application that is not a directory: " +
                        appSpec.appDir);
                }
                return createBookmarkStateDirectory(appSpec.settings.appDefaults.bookmarkStateDir, appSpec.runAs);
            })
                .then(function () {
                self.$proc = child_process.spawn(executable, args, {
                    stdio: ["pipe", "pipe", "pipe"],
                    cwd: appSpec.appDir,
                    env: map.compact({
                        HOME: home,
                        LANG: process.env["LANG"],
                        PATH: process.env["PATH"]
                    }),
                    detached: true
                });
                self.$proc.on("exit", function (code, signal) {
                    self.exited = true;
                    self.$dfEnded.resolve({ code: code, signal: signal });
                });
                self.$proc.stdin.on("error", function () {
                    logger.warn("Unable to write to Shiny process. Attempting to kill it.");
                    self.kill();
                });
                self.$proc.stdin.end(shinyInput_1);
                var stdoutSplit = self.$proc.stdout.pipe(split());
                stdoutSplit.on("data", function stdoutSplitListener(line) {
                    var match = line.match(/^shiny_launch_info: (.*)$/);
                    if (match) {
                        var shinyOutput = JSON.parse(match[1]);
                        self.$pid = shinyOutput.pid;
                        logger.trace("R process spawned with pid ".concat(shinyOutput.pid));
                        logger.trace("R version: ".concat(shinyOutput.versions.r));
                        logger.trace("Shiny version: ".concat(shinyOutput.versions.shiny));
                        logger.trace("rmarkdown version: ".concat(shinyOutput.versions.rmarkdown));
                        logger.trace("knitr version: ".concat(shinyOutput.versions.knitr));
                    }
                    else if (line.match(/^==END==$/)) {
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
                        logger.info("[".concat(appSpec.appDir, ":").concat(self.$pid, "] ").concat(line));
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
        }
        catch (e) {
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
    AppWorker.prototype.getExit_p = function () {
        return this.$dfEnded.promise;
    };
    AppWorker.prototype.isRunning = function () {
        return !this.exited;
    };
    /**
     * Attempts to kill the process using the signal provided by
     * sending a SIGINT signal to the R process; if the process
     * is still alive after a few seconds, we send SIGTERM.
     */
    AppWorker.prototype.kill = function (force) {
        if (force === void 0) { force = false; }
        var exitPromise = this.getExit_p();
        if (!exitPromise.isPending())
            return;
        var signal = force ? "SIGTERM" : "SIGINT";
        var pid = this.$pid;
        logger.trace("Sending ".concat(signal, " to ").concat(pid));
        try {
            process.kill(pid, signal);
            if (!force) {
                var timerId = setTimeout(function () {
                    logger.debug("Process ".concat(pid, " did not exit on ").concat(signal, "; sending SIGTERM"));
                    try {
                        process.kill(pid, "SIGTERM");
                    }
                    catch (e) {
                        logger.trace("Failure sending SIGTERM: " + e);
                    }
                }, 20000); // TODO: Should this be configurable?
            }
            exitPromise
                .then(function () {
                clearTimeout(timerId);
            })
                .eat();
        }
        catch (e) {
            logger.trace("Failure sending ".concat(signal, ": ") + e);
        }
    };
    return AppWorker;
}());
function createShinyInput(appSpec, endpoint, workerId, logFile) {
    var _a;
    // Set mode to either 'shiny' or 'rmd'
    var mode = "shiny";
    if (appSpec.settings && appSpec.settings.mode) {
        mode = appSpec.settings.mode;
    }
    return {
        appDir: appSpec.appDir,
        port: endpoint.getAppWorkerPort(),
        gaTrackingId: (_a = appSpec.settings.gaTrackingId) !== null && _a !== void 0 ? _a : "",
        sharedSecret: endpoint.getSharedSecret(),
        shinyServerVersion: SHINY_SERVER_VERSION,
        workerId: workerId,
        mode: mode,
        pandocPath: paths.projectFile("ext/pandoc"),
        logFilePath: logFile !== null && logFile !== void 0 ? logFile : "",
        disableProtocols: appSpec.settings.appDefaults.disableProtocols.join(","),
        reconnect: appSpec.settings.appDefaults.reconnect,
        sanitizeErrors: appSpec.settings.appDefaults.sanitizeErrors,
        bookmarkStateDir: appSpec.settings.appDefaults.bookmarkStateDir
    };
}
