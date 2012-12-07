var AppSpec = function(appDir, runAs, prefix, logDir, settings) {
  this.appDir = appDir;
  this.runAs = runAs;
  this.prefix = prefix;
  this.logDir = logDir;
  this.settings = settings;
};
module.exports = AppSpec;

(function() {

  this.getKey = function() {
    JSON.stringify(this);
  };

}).call(AppSpec.prototype);