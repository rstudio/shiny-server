"use strict";
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
exports.resolvePython_p = resolvePython_p;
const fs_promises = __importStar(require("fs/promises"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const fsutil = require("./fsutil");
async function resolvePython_p(pythonPath, baseDir) {
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
        }
        else if (stat.isFile()) {
            try {
                await fs_promises.access(pythonPath, fs.constants.X_OK);
            }
            catch {
                throw new Error(`Can't execute the specified python binary: '${pythonPath}'`);
            }
            // Assume that a direct path to a "real" python was provided.
            return {
                exec: pythonPath,
            };
        }
        else {
            // Make compiler happy
            throw new Error(`The python path '${pythonPath}' is not a file, directory, or symbolic link`);
        }
    }
    else if (!pythonPath.includes(path.sep)) {
        // Ideally, we would search the path now, but I think we have to wait until
        // we've switched to the runAs user, in case their path is different
        return {
            command: pythonPath,
        };
    }
    else if (baseDir && path.isAbsolute(baseDir ?? "")) {
        return await resolvePython_p(path.resolve(baseDir, pythonPath));
    }
    else {
        throw new Error(`Invalid python path specified: ${pythonPath}`);
    }
}
