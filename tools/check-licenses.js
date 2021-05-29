var fs = require("fs");
var path = require("path");

// Some package maintainers cannot be bothered to put license info
// in their package.json, but have the info available elsewhere

var KNOWN_LICENSES = {
  "bash@0.0.1":           "MIT",
  "commander@0.6.1":      "MIT",
  "commander@2.3.0":      "MIT",
  "commander@2.9.0":      "MIT",
  "debug@2.0.0":          "MIT",
  "debug@2.2.0":          "MIT",
  "formatio@1.1.1":       "BSD-3-Clause",
  "growl@1.8.1":          "MIT",
  "growl@1.9.2":          "MIT",
  "jade@0.26.3":          "MIT",
  "keygrip@1.0.1":        "MIT",
  "ms@0.6.2":             "MIT",
  "ms@0.7.1":             "MIT",
  "samsam@1.1.2":         "BSD-3-Clause",
};

// Some licenses are ambiguous and require manual investigation
// to prove they are both GPL- and commercial-compatible

var OVERRIDE_LICENSES = {
  "argparse@2.0.1":       "BSD-3-Clause", // Actually Python-2.0 is in the package.json but the real license is GPL compatible whereas Python-2.0 is ambiguous
};

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file));
}

function getLicense(packageJson) {
  var pkgKey = packageJson.name + "@" + packageJson.version;

  var overrideLicense = OVERRIDE_LICENSES[pkgKey];
  if (typeof(overrideLicense) !== "undefined") {
    return overrideLicense;
  }

  var license = packageJson.license ||
    (packageJson.licenses && packageJson.licenses[0]) ||
    (packageJson.licenses && packageJson.licenses.type);
  if (typeof(license) === "undefined") {
    return KNOWN_LICENSES[pkgKey];
  }
  if (typeof(license) === "string") {
    return license;
  } else if (typeof(license) === "object" && license.type) {
    return license.type;
  } else {
    throw new Error("Unknown license");
  }
}

function getPackageJson(basedir) {
  var result = [];
  var children = fs.readdirSync(basedir);
  children.forEach(function(child) {
    child = basedir + "/" + child;
    var lstat = fs.lstatSync(child);
    if (lstat.isDirectory() && !lstat.isSymbolicLink()) {
      result = result.concat(getPackageJson(child));
    } else if (path.basename(child) === "package.json" &&
        path.basename(path.dirname(path.dirname(child))) === "node_modules" &&
        // rewire has some fake packages embedded
        !/\/rewire\/testLib\//.test(child)) {
      result.push(child);
    }
  });
  return result;
}

function isApprovedLicense(license) {
  return /^(MIT|MIT\/X11|BSD|0BSD|BSD-3-Clause|BSD-2-Clause|ISC|Apache[- ]2.0|Apache License, Version 2.0|WTFPL|Public Domain|MPL[- ]2.0|zlib|Unlicense|\(MIT OR CC0-1.0\))$/.test(license);
}

function getLicenses(path) {
  return getPackageJson(path).map(function(package) {
    try {
      var packageInfo = readJSON(package);
      var license = getLicense(packageInfo);
      return {
        name: packageInfo.name + "@" + packageInfo.version,
        path: package,
        license: license
      };
    } catch (err) {
      throw new Error("Error reading " + package + ": " + err.message);
    }
  }).sort(function(a, b) {
    a = a.name.toUpperCase();
    b = b.name.toUpperCase();
    return (a < b) ? -1 :
      (b < a) ? 1 :
      0;
  });
}

function showAllLicenses(unapprovedOnly) {
  getLicenses("node_modules").forEach(function(info) {
    if (!unapprovedOnly || !isApprovedLicense(info.license)) {
      console.log(
        (info.license || "[NONE]") + "\t" +
        info.name + "\t" +
        info.path
      );
    }
  });
}

function checkLicenses() {
  var anyUnapproved = false;
  getLicenses("node_modules").forEach(function(info) {
    if (!isApprovedLicense(info.license) && !/^shiny-server-client@/.test(info.name)) {
      anyUnapproved = true;
      console.error(
        (info.license || "[NONE]") + "\t" +
        info.name + "\t" +
        info.path
      );      
    }
  });
  if (anyUnapproved) {
    console.error("ERROR: License check failed! See the above dependencies.");
    process.exit(1);
  }
}

checkLicenses();
