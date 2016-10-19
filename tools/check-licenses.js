var fs = require("fs");
var path = require("path");

// Some package maintainers cannot be bothered to put license info
// in their package.json, but have the info available elsewhere

var KNOWN_LICENSES = {
  bash:           "MIT",
  commander:      "MIT",
  debug:          "MIT",
  formatio:       "BSD-3-Clause",
  growl:          "MIT",
  jade:           "MIT",
  keygrip:        "MIT",
  ms:             "MIT",
  "regexp-quote": "MIT",
  samsam:         "BSD-3-Clause",
  unixgroups:     "MIT",
};

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file));
}

function getLicense(packageJson) {
  var license = packageJson.license ||
    (packageJson.licenses && packageJson.licenses[0]) ||
    (packageJson.licenses && packageJson.licenses.type);
  if (typeof(license) === "undefined") {
    return KNOWN_LICENSES[packageJson.name];
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
  return /^MIT|BSD|BSD-3-Clause|ISC|Apache[- ]2.0|WTFPL|Public Domain|MPL 2.0|zlib$/.test(license);
}

function getLicenses(path) {
  return getPackageJson(path).map(function(package) {
    try {
      var packageInfo = readJSON(package);
      var license = getLicense(packageInfo);
      return {
        name: packageInfo.name,
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
    if (!isApprovedLicense(info.license) && info.name !== "shiny-server-client") {
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
