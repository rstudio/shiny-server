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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.launchWorker_p = launchWorker_p;
/**
 * An AppWorker is responsible for:
 *
 * - Launching a Shiny application with the proper user/group permissions
 * - Ensuring that stderr is written to the specified path
 * - Returning a promise that resolves when the worker process exits
 */
const child_process = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const fs_promises = __importStar(require("fs/promises"));
var path = require("path");
var bash = require("bash");
const Q = require("q");
const split = require("split");
var map = require("../core/map");
var paths = require("../core/paths");
var permissions = require("../core/permissions");
var posix = require("../../build/Release/posix");
const python = __importStar(require("../core/python"));
var rprog = process.env.R || "R";
const shinyScriptPath = paths.projectFile("R/SockJSAdapter.R");
const pythonScriptPath = paths.projectFile("python/SockJSAdapter.py");
const STDERR_PASSTHROUGH = !!process.env["SHINY_LOG_STDERR"];
async function exists(path) {
    try {
        await fs_promises.access(path);
        return true;
    }
    catch (ex) {
        return false;
    }
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
    return Q.resolve(exists(appSpec.appDir)).then(async function (exists) {
        // TODO: does this need to be as user?
        if (!exists) {
            var err = new Error("App dir " + appSpec.appDir + " does not exist");
            err.code = "ENOTFOUND";
            throw err;
        }
        let logStream;
        if (!appSpec.settings.logAsUser) {
            logStream = await createLogFile(pw, appSpec, logFilePath);
            // logStream is now a WriteStream; it is the responsibility of the
            // AppWorker to close it, either on failure in the constructor or
            // (if construction succeeds) when the worker process exits.
        }
        else {
            logStream = await createLogFileAsUser(pw, appSpec, logFilePath);
        }
        var worker = await createAppWorker(appSpec, endpoint, logStream, workerId, pw.home);
        return worker;
    });
}
async function createLogFileAsUser(pw, appSpec, logFilePath) {
    logger.trace(`Creating ${logFilePath} as user`);
    return new Promise((resolve, reject) => {
        let mode = appSpec.settings.appDefaults.logFileMode;
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
    });
}
async function createLogFile(pw, appSpec, logFilePath) {
    logger.trace(`Creating ${logFilePath}`);
    var logDir = path.dirname(logFilePath);
    // Ensure that the log directory exists.
    try {
        fs.mkdirSync(logDir, "755");
        fs.chownSync(logDir, pw.uid, pw.gid);
    }
    catch (ex) {
        try {
            var stat = fs.statSync(logDir);
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
    let mode = appSpec.settings.appDefaults.logFileMode;
    const fileHandle = await fs_promises.open(logFilePath, "a", mode);
    try {
        await fileHandle.chown(pw.uid, pw.gid);
    }
    catch (ex) {
        logger.error(`Error attempting to change ownership of log file at ${logFilePath}: ${ex.message}`);
    }
    try {
        await fileHandle.chmod(mode);
    }
    catch (ex) {
        logger.error(`Error attempting to change permissions on log file at ${logFilePath}: ${ex.message}`);
    }
    // We got a file descriptor and have chowned the file which is great, but
    // we actually want a writeStream for this file so we can handle async
    // writes more cleanly.
    const writeStream = fileHandle.createWriteStream();
    // If we have problems writing to writeStream, report it at most once.
    var warned = false;
    writeStream.on("error", function (err) {
        if (!warned) {
            warned = true;
            logger.warn("Error writing to log stream: ", err);
        }
    });
    return writeStream;
}
/**
 * Creates the top-level (system) bookmark state directory, then the user's
 * bookmark state directory, and then the app's bookmark state directory.
 */
async function createBookmarkStateDirectory(bookmarkStateDir, username) {
    if (bookmarkStateDir === null || bookmarkStateDir === "") {
        return;
    }
    async function createDir(dir, mode, username, label) {
        if (label) {
            label = label + " ";
        }
        else {
            label = "";
        }
        try {
            await fs_promises.mkdir(dir, mode);
            logger.info(`created ${label}bookmark state directory: ${dir}`);
            if (typeof username === "string") {
                var pw = posix.getpwnam(username);
                await fs_promises.chown(dir, pw.uid, pw.gid);
            }
        }
        catch (ex) {
            try {
                const stat = await fs_promises.stat(dir);
                if (!stat.isDirectory()) {
                    logger.error(`${label}bookmark state directory existed, was a file: ${dir}`);
                }
                // We couldn't create it because it already existed--that's fine.
                return;
            }
            catch { }
            logger.error(`Failed to create ${label}bookmark state directory: ${dir}`);
            throw ex;
        }
    }
    var userBookmarkStateDir = path.join(bookmarkStateDir, username);
    await createDir(bookmarkStateDir, "711");
    await createDir(userBookmarkStateDir, "700", username, "user");
}
async function createAppWorker(appSpec, endpoint, logStream, workerId, home) {
    // Spawn worker process via su, to ensure proper setgid, initgroups, setuid,
    // etc. are called correctly.
    //
    // We use stdin to tell SockJSAdapter what app dir, port, etc. to use, so
    // that non-root users on the system can't use ps to discover what apps are
    // available and on what ports.
    logger.trace("Starting worker");
    // Run R
    var executable, args;
    var switchUser = appSpec.runAs !== null && permissions.getProcessUser() !== appSpec.runAs;
    if (typeof appSpec.runAs === "object") {
        throw new Error("Assertion error: appSpec.runAs should be a string or null at this point");
    }
    if (!switchUser && permissions.isSuperuser())
        throw new Error("Aborting attempt to launch worker process as root");
    // The file where worker should send stderr, or empty if it should leave it alone.
    var logFile = "";
    if (typeof logStream === "string") {
        logFile = logStream;
        logStream = "ignore"; // Tell the child process to drop stderr
        logger.trace("Asking worker to send stderr to " + logFile);
    }
    let spawnSpec;
    switch (appSpec.settings.mode) {
        case "shiny":
        case "rmd":
            spawnSpec = createShinySpawnSpec(appSpec, endpoint, workerId, logFile, home);
            break;
        case "shiny-python":
            spawnSpec = await createPyShinySpawnSpec(appSpec, endpoint, workerId, logFile, home);
            break;
        default:
            throw new Error(`Tried to launch worker process with unknown mode: ${appSpec.settings.mode}`);
    }
    if (switchUser) {
        spawnSpec = wrapWithUserSwitch(spawnSpec, appSpec.runAs);
    }
    try {
        const stat = await fs_promises.stat(appSpec.appDir);
        if (!stat.isDirectory()) {
            throw new Error("Trying to launch an application that is not a directory: " +
                appSpec.appDir);
        }
        await createBookmarkStateDirectory(appSpec.settings.appDefaults.bookmarkStateDir, appSpec.runAs);
        const proc = child_process.spawn(spawnSpec.command, spawnSpec.args, {
            stdio: ["pipe", "pipe", "pipe"],
            cwd: spawnSpec.cwd,
            env: spawnSpec.env,
            detached: true, // So that we can send SIGINT not just to su but to the
            // worker process that it spawns as well
        });
        const dfEnd = Q.defer();
        const appWorker = new AppWorker(dfEnd.promise, proc);
        try {
            proc.on("exit", function (code, signal) {
                appWorker.exited = true;
                dfEnd.resolve({ code: code, signal: signal });
            });
            proc.stdin.on("error", function () {
                logger.warn("Unable to write to Shiny process. Attempting to kill it.");
                proc.kill();
            });
            proc.stdin.end(spawnSpec.stdinInput);
            var stdoutSplit = proc.stdout.pipe(split());
            stdoutSplit.on("data", function stdoutSplitListener(line) {
                const match = line.match(/^shiny_launch_info: (.*)$/);
                if (match) {
                    const shinyOutput = JSON.parse(match[1]);
                    appWorker.pid = shinyOutput.pid;
                    logger.trace(`Worker process spawned with pid ${shinyOutput.pid}`);
                    for (const [key, value] of Object.entries(shinyOutput.versions)) {
                        logger.trace(`${key} version: ${value}`);
                    }
                }
                else if (line.match(/^==END==$/)) {
                    stdoutSplit.off("data", stdoutSplitListener);
                    logger.trace("Closing backchannel");
                }
            });
            proc.stderr
                .on("error", function (e) {
                logger.error("Error on proc stderr: " + e);
            })
                .pipe(split())
                .on("data", function (line) {
                if (STDERR_PASSTHROUGH) {
                    logger.info(`[${appSpec.appDir}:${appWorker.pid ?? "?"}] ${line}`);
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
            return appWorker;
        }
        catch (ex2) {
            try {
                if (appWorker.pid) {
                    // If app initialization got far enough that we know the grandchild
                    // process, kill that one.
                    appWorker.kill();
                }
                else {
                    // If not, kill the direct child process.
                    proc.kill();
                }
            }
            catch (ex3) {
                logger.debug(`Failed to cleanup after failure to launch child process: ${ex3.message}`);
            }
            throw ex2;
        }
    }
    catch (ex) {
        // We never got around to starting the process, so the normal code path
        // that closes logStream won't run.
        if (typeof logStream !== "string") {
            logStream.end();
        }
        throw ex;
    }
}
/**
 * An AppWorker models a single worker process that is running a Shiny app.
 *
 * @constructor
 * @param {AppSpec} appSpec - Contains the basic details about the app to
 *   launch
 * @param {String} endpoint - The transport endpoint the app should listen on
 * @param {Stream} logStream - The stream to dump stderr to, or the path to
 *   the file where the logging should happen. If just the path, pass it in
 *   to the worker proc to have it handle the logging itself.
 */
class AppWorker {
    $end;
    $proc;
    exited;
    pid;
    constructor(end, proc) {
        this.$end = end;
        this.$proc = proc;
        this.exited = false;
        this.pid = null;
    }
    /**
     * Returns a promise that is resolved when the process exits.
     * If the process terminated normally, code is the final exit
     * code of the process, otherwise null. If the process
     * terminated due to receipt of a signal, signal is the string
     * name of the signal, otherwise null.
     */
    getExit_p() {
        return this.$end;
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
        if (!exitPromise.isPending())
            return;
        const signal = force ? "SIGTERM" : "SIGINT";
        const pid = this.pid || this.$proc.pid;
        if (!pid) {
            return;
        }
        logger.trace(`Sending ${signal} to ${pid}`);
        try {
            process.kill(pid, signal);
            if (!force) {
                var timerId = setTimeout(function () {
                    logger.debug(`Process ${pid} did not exit on ${signal}; sending SIGTERM`);
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
            logger.trace(`Failure sending ${signal}: ` + e);
        }
    }
}
function createShinyInput(appSpec, endpoint, workerId, logFile) {
    return {
        appDir: appSpec.appDir,
        port: endpoint.getAppWorkerPort(),
        gaTrackingId: appSpec.settings.gaTrackingId ?? "",
        sharedSecret: endpoint.getSharedSecret(),
        shinyServerVersion: SHINY_SERVER_VERSION,
        workerId,
        mode: appSpec.settings.mode,
        pandocPath: paths.projectFile("ext/pandoc"),
        logFilePath: logFile ?? "",
        disableProtocols: appSpec.settings.appDefaults.disableProtocols,
        reconnect: appSpec.settings.appDefaults.reconnect,
        sanitizeErrors: appSpec.settings.appDefaults.sanitizeErrors,
        bookmarkStateDir: appSpec.settings.appDefaults.bookmarkStateDir,
    };
}
function createShinySpawnSpec(appSpec, endpoint, workerId, logFile, home) {
    const shinyInput = JSON.stringify(createShinyInput(appSpec, endpoint, workerId, logFile)) +
        "\n";
    let spawnSpec = {
        command: rprog,
        args: ["--no-save", "--slave", "-f", shinyScriptPath],
        cwd: appSpec.appDir,
        env: map.compact({
            HOME: home,
            LANG: process.env["LANG"],
            PATH: process.env["PATH"],
        }),
        stdinInput: shinyInput,
    };
    return spawnSpec;
}
async function createPyShinySpawnSpec(appSpec, endpoint, workerId, logFile, home) {
    const shinyInput = JSON.stringify(createShinyInput(appSpec, endpoint, workerId, logFile)) +
        "\n";
    const pythonPath = appSpec.settings.appDefaults.python ?? "python3";
    const pythonResult = await python.resolvePython_p(pythonPath, appSpec.appDir);
    const env = map.compact(Object.assign({
        HOME: home,
        LANG: process.env["LANG"],
        PATH: process.env["PATH"],
    }, pythonResult.env ?? {}));
    if (pythonResult.path_prepend) {
        env["PATH"] = pythonResult.path_prepend + ":" + env["PATH"];
    }
    // Turn off buffering in sys.stdout/sys.stderr. This is necessary because
    // SockJSAdapter.py redirects stdout to stderr, and if those objects buffer
    // then you can get incorrect line ordering.
    env["PYTHONUNBUFFERED"] = "1";
    let spawnSpec = {
        command: pythonResult.command ?? pythonResult.exec,
        args: [pythonScriptPath],
        cwd: appSpec.appDir,
        env,
        stdinInput: shinyInput,
    };
    return spawnSpec;
}
function wrapWithUserSwitch(spec, user) {
    const command = "su";
    let args = [
        "-m",
        "--",
        user,
        "-c",
        "cd " +
            bash.escape(spec.cwd) +
            " && " +
            [spec.command, ...spec.args].map((arg) => bash.escape(arg)).join(" "),
    ];
    if (process.platform === "linux") {
        // -s option not supported by OS X (or FreeBSD, or Sun)
        args = ["-s", "/bin/bash", "--login"].concat(args);
    }
    else {
        // Other platforms don't clear out env vars, so simulate user env
        args.unshift("-");
    }
    return {
        command,
        args,
        cwd: spec.cwd,
        env: spec.env,
        stdinInput: spec.stdinInput,
    };
}
