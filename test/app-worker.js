const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { StringDecoder } = require("string_decoder");

const rewire = require("rewire");
const bash = require("bash");
const sinon = require("sinon");

const app_worker = rewire("../lib/worker/app-worker");
const AppSpec = require("../lib/worker/app-spec");
const paths = require("../lib/core/paths");
const { Transport } = require("../lib/transport/tcp");
const { Stream } = require("stream");
const EventEmitter = require("events");
const { reject } = require("underscore");

if (!global["SHINY_SERVER_VERSION"]) {
  global["SHINY_SERVER_VERSION"] = "0.0.0.0";
}

/****************************************************************
 * Infrastructure for mocking child_process.spawn               *
 ****************************************************************/

const mock_spawn = sinon.stub();

app_worker.__set__(
  "child_process",
  Object.assign(Object.create(null), app_worker.__get__("child_process"), {
    spawn: mock_spawn,
  })
);

class MockChildProcess extends EventEmitter {
  constructor(command, args, options) {
    super();
    this.command = command;
    this.args = args;
    this.options = options;
    this.pid = 9999;

    this.stdin = new Stream.PassThrough();
    this.stdout = new Stream.PassThrough();
    this.stderr = new Stream.PassThrough();

    this._keepalive = setTimeout(() => {}, 1e9);
  }

  kill(signal = "SIGTERM") {
    this.die(null, signal);
  }

  die(code, signal) {
    clearTimeout(this._keepalive);
    this.emit("exit", code, signal);
    this.stdin.destroy();
    this.stdout.destroy();
    this.stderr.destroy();
    this.emit("close", code, signal);
  }
}

/****************************************************************
 * Helper functions                                             *
 ****************************************************************/

// Deletes the file/directory at path if it exists, otherwise no-op.
async function rmIfExists(path, isDir) {
  if (!isDir) {
    await fs.rm(path, { force: true });
  } else {
    try {
      await fs.access(path);
    } catch (err) {
      return;
    }
    await fs.rmdir(path);
  }
}

// Returns a promise that resolves when `fn()` returns truthy.
// It will try calling fn() every `interval` milliseconds.
async function poll(fn, interval = 10) {
  return await new Promise((resolve, reject) => {
    const handle = setInterval(() => {
      try {
        const value = fn();
        if (value) {
          clearInterval(handle);
          resolve(value);
        }
      } catch (ex) {
        clearInterval(handle);
        reject(ex);
      }
    }, interval);
  });
}

/****************************************************************
 * Runs launchWorker_p, checking pre- and post-conditions, and  *
 * also sets up state for the mock impl of child_process.spawn  *
 ****************************************************************/

async function testLaunchWorker_p(
  appSpec,
  logFilePath,
  pw,
  endpoint,
  workerId,
  // If true, assume the launch is supposed to be successful, and run some
  // tests. If false, return the AppWorker once it's created.
  wait = true
) {
  // These must always be equal--if not, the appSpec was malformed (i.e. bad test)
  assert.strictEqual(appSpec.logAsUser, appSpec.settings.logAsUser);

  const userBookmarkStateDir = path.join(
    appSpec.settings.appDefaults.bookmarkStateDir,
    appSpec.runAs
  );

  async function cleanup() {
    // Reset state
    await rmIfExists(logFilePath, false);
    await rmIfExists(userBookmarkStateDir, true);
    await rmIfExists(appSpec.settings.appDefaults.bookmarkStateDir, true);
    // Reset both the history and behavior of spawn
    mock_spawn.reset();
  }

  await cleanup();

  try {
    // Launch R; the default behavior of the child_process.spawn stub.
    // Receive input on stdin, write some canned stuff to stdout/err,
    // then stay "alive" while waiting for someone to kill us with a
    // signal.
    mock_spawn.callsFake((command, args, options) => {
      const proc = new MockChildProcess(command, args, options);
      proc.stdout.end("==END==\n");
      proc.stderr.end("This is the contents of stderr");
      proc.on("exit", () => {
        const stdin_str = new StringDecoder().end(proc.stdin.read());
        assert.strictEqual(
          stdin_str,
          expectedRStdin({
            appSpec,
            endpoint,
            workerId,
            logFilePath: appSpec.logAsUser ? logFilePath : "",
          })
        );
      });
      return proc;
    });

    if (appSpec.logAsUser) {
      // Create log; the behavior of just the FIRST call to spawn.
      // (Basically just exit right away with an exit code of 0.)
      mock_spawn.onCall(0).callsFake((command, args, options) => {
        const proc = new MockChildProcess(command, args, options);
        setTimeout(() => {
          proc.die(0);
        }, 0);
        return proc;
      });
    }

    // Finally, we can call the function we're trying to test.
    const worker = await app_worker.launchWorker_p(
      appSpec,
      pw,
      endpoint,
      logFilePath,
      workerId
    );

    if (!wait) {
      // The caller just wants the worker right away
      return worker;
    }

    // Wait until worker.$proc is populated. (It feels like a flaw in launchWorker_p
    // that there's a window of time where $proc isn't populated)
    await poll(() => !!worker.$proc);

    // Ensure that calls to child_process.spawn() were exactly as expected
    assert(mock_spawn.callCount == (appSpec.logAsUser ? 2 : 1));
    if (appSpec.logAsUser) {
      assert.deepStrictEqual(
        mock_spawn.firstCall.args,
        expectedSpawnLogParams(logFilePath, pw)
      );
    }
    assert.deepStrictEqual(
      mock_spawn.lastCall.args,
      expectedSpawnRParams(appSpec, pw)
    );

    worker.$proc.kill();

    assert.deepEqual(await worker.getExit_p(), {
      code: null,
      signal: "SIGTERM",
    });

    if (appSpec.logAsUser) {
      // If logAsUser, then the logFilePath shouldn't exist (it's the responsibility
      // of the worker process to create it)
      assert.rejects(fs.access(logFilePath));
    } else {
      const logContents = await fs.readFile(logFilePath, { encoding: "utf-8" });
      assert.deepEqual(logContents, "This is the contents of stderr\n");
    }

    const stat = await fs.stat(userBookmarkStateDir);
    assert(stat.isDirectory());
    assert.strictEqual(stat.mode & 0o777, 0o700);
    // Can't confirm ownership; chown doesn't succeed when testing as non-root
    // assert.strictEqual(stat.uid, pw.uid);
  } finally {
    await cleanup();
  }
}

/****************************************************************
 * Helper functions for creating input                          *
 ****************************************************************/

function createAppSpec() {
  const appDir = paths.projectFile("test/apps/01_hello");
  const runAs = process.env["USER"];
  const prefix = "";
  const logDir = os.tmpdir();
  const settings = {
    templateDir: "",
    // restart: undefined,
    mode: "shiny",
    scheduler: { simple: { maxRequests: 100 } },
    logAsUser: false,
    gaTrackingId: "UA-blahblah-1",
    appDefaults: {
      initTimeout: 0,
      idleTimeout: 0,
      preserveLogs: false,
      reconnect: true,
      sanitizeErrors: false,
      disableProtocols: ["websocket", "xhr-streaming"],
      bookmarkStateDir: path.join(os.tmpdir(), "app-worker-test-bookmarks"),
      logFileMode: "777",
      frameOptions: undefined,
    },
  };

  return new AppSpec(appDir, runAs, prefix, logDir, settings);
}

async function createBaselineInput() {
  const appSpec = createAppSpec();
  const pw = {
    uid: process.getuid(),
    gid: process.getgid(),
    home: process.env["HOME"],
  };

  const endpoint = await new Transport().alloc_p();
  const logFilePath = path.join(appSpec.logDir, "app-worker-test.log");
  const workerId = "abcd1234";

  return { appSpec, pw, endpoint, logFilePath, workerId };
}

/****************************************************************
 * Helper functions for creating expected values                *
 ****************************************************************/

function expectedSpawnLogParams(logFilePath, pw) {
  return [
    paths.projectFile("scripts/create-log.sh"),
    [logFilePath, "777"],
    {
      uid: pw.uid,
      gid: pw.gid,
    },
  ];
}

function expectedSpawnRParams(appSpec, pw) {
  if (appSpec.runAs !== process.env["USER"]) {
    return [
      "su",
      [
        "-",
        "-p",
        "--",
        appSpec.runAs,
        "-c",
        `cd ${bash.escape(
          appSpec.appDir
        )} && R --no-save --slave -f ${bash.escape(
          paths.projectFile("R/SockJSAdapter.R")
        )}`,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: appSpec.appDir,
        env: {
          HOME: pw.home,
          LANG: process.env["LANG"],
          PATH: process.env["PATH"],
        },
        detached: true,
      },
    ];
  } else {
    return [
      "R",
      ["--no-save", "--slave", "-f", paths.projectFile("R/SockJSAdapter.R")],
      {
        cwd: appSpec.appDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          HOME: process.env["HOME"],
          LANG: process.env["LANG"],
          PATH: process.env["PATH"],
        },
        detached: true,
      },
    ];
  }
}

function expectedRStdin({ appSpec, endpoint, workerId, logFilePath }) {
  return (
    [
      appSpec.appDir,
      endpoint.getAppWorkerPort(),
      appSpec.settings.gaTrackingId,
      endpoint.getSharedSecret(),
      SHINY_SERVER_VERSION,
      workerId,
      "shiny",
      paths.projectFile("ext/pandoc"),
      logFilePath,
      "websocket,xhr-streaming", // disableProtocols
      "true", // reconnect
      "false", // sanitizeErrors
      appSpec.settings.appDefaults.bookmarkStateDir, // bookmarkStateDir
    ].join("\n") + "\n"
  );
}

/****************************************************************
 * The actual test cases                                        *
 ****************************************************************/

describe("app-worker", () => {
  it("works with logAsUser:false and current user", async () => {
    const { appSpec, pw, endpoint, logFilePath, workerId } =
      await createBaselineInput();

    await testLaunchWorker_p(appSpec, logFilePath, pw, endpoint, workerId);
  });

  it("works with logAsUser:true and switching user", async () => {
    const {
      appSpec,
      pw: _,
      endpoint,
      logFilePath,
      workerId,
    } = await createBaselineInput();

    appSpec.logAsUser = appSpec.settings.logAsUser = true;
    appSpec.runAs = "someone_else";

    const pw = {
      uid: 1111,
      gid: 1112,
      home: "/home/someone_else",
    };

    await testLaunchWorker_p(appSpec, logFilePath, pw, endpoint, workerId);
  });

  it("fails to launch when user is missing", async () => {
    const {
      appSpec,
      pw: _,
      endpoint,
      logFilePath,
      workerId,
    } = await createBaselineInput();
    const pw = null;

    try {
      await testLaunchWorker_p(appSpec, logFilePath, pw, endpoint, workerId);
      assert.fail("Launch was supposed to fail but didn't");
    } catch (ex) {
      assert.match(ex.message, /User .* does not exist/);
    }
  });

  it("fails to launch when user's home dir is missing", async () => {
    const { appSpec, pw, endpoint, logFilePath, workerId } =
      await createBaselineInput();
    pw.home = null;

    try {
      await testLaunchWorker_p(appSpec, logFilePath, pw, endpoint, workerId);
      assert.fail("Launch was supposed to fail but didn't");
    } catch (ex) {
      assert.match(ex.message, /User .* does not have a home directory/);
    }
  });

  it("fails to launch when app dir is incorrect", async () => {
    const { appSpec, pw, endpoint, logFilePath, workerId } =
      await createBaselineInput();

    appSpec.appDir = "/path/that/doesnt/exist";
    try {
      await testLaunchWorker_p(appSpec, logFilePath, pw, endpoint, workerId);
      assert.fail("Launch was supposed to fail but didn't");
    } catch (ex) {
      assert.match(ex.message, /App dir .* does not exist/);
    }

    appSpec.appDir = null;
    try {
      await testLaunchWorker_p(appSpec, logFilePath, pw, endpoint, workerId);
      assert.fail("Launch was supposed to fail but didn't");
    } catch (ex) {
      assert.strictEqual(ex.message, "No app directory specified");
    }
  });

  it("fails to launch when bookmark state dir is invalid", async () => {
    const { appSpec, pw, endpoint, logFilePath, workerId } =
      await createBaselineInput();
    appSpec.settings.appDefaults.bookmarkStateDir = "/blah";

    // This fails, but not with an unsuccessful testLaunchWorker_p(), but
    // rather by returning an AppWorker that never launched its child process

    const appWorker = await testLaunchWorker_p(
      appSpec,
      logFilePath,
      pw,
      endpoint,
      workerId,
      false // don't wait
    );
    const { code, signal } = await appWorker.getExit_p();
    assert.strictEqual(code, -1);
  });
});
