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
    return this.appDir + "\n" +
      this.runAs + "\n" +
      this.prefix + "\n" +
      this.logDir + "\n" +
      JSON.stringify(this.settings);
  };

}).call(AppSpec.prototype);