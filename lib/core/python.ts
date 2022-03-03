import * as fs_promises from "fs/promises";
import * as fs from "fs";
import * as path from "path";
import Q = require("q");

import fsutil = require("./fsutil");

interface PythonEnv {
  exec?: string;
  command?: string;
  path_prepend?: string;
  env?: Record<string, string | null>;
}

export async function resolvePython_p(pythonPath: string, baseDir?: string): Q.Promise<PythonEnv> {
  if (path.isAbsolute(pythonPath)) {
    let stat = await fs_promises.stat(pythonPath);
    if (stat.isDirectory()) {
      // virtualenv/venv support. Assume that the directory is a virtual
      // environment directory. Add its bin directory to the path, clear
      // $PYTHONHOME, and add $VIRTUAL_ENV.
      // https://github.com/python/cpython/blob/d7a5aca982def155a9255893cefcc1493c127c9c/Lib/venv/scripts/common/activate#L38-L54

      const binPath = path.join(pythonPath, "bin", "python");
      if (!await fsutil.exists_p(binPath)) {
        throw new Error(`The python path '${pythonPath}' does not contain bin/python`);
      }
      return {
        exec: binPath,
        path_prepend: path.join(pythonPath, "bin"),
        env: {
          virtual_env: pythonPath,
          pythonhome: null,
        },
      };
    } else if (stat.isFile()) {
      try {
        await fs_promises.access(pythonPath, fs.constants.X_OK);
      } catch {
        throw new Error(`Can't execute the specified python binary: '${pythonPath}'`);
      }
      // Assume that a direct path to a "real" python was provided.
      return {
        exec: pythonPath,
      };
    } else {
      // Make compiler happy
      throw new Error(`The python path '${pythonPath}' is not a file, directory, or symbolic link`);
    }
  } else if (!pythonPath.includes(path.sep)) {
    // Ideally, we would search the path now, but I think we have to wait until
    // we've switched to the runAs user, in case their path is different
    return {
      command: pythonPath,
    };
  } else if (baseDir && path.isAbsolute(baseDir ?? "")) {
    return await resolvePython_p(path.resolve(baseDir, pythonPath));
  } else {
    throw new Error(`Invalid python path specified: ${pythonPath}`);
  }
}
