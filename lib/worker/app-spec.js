var AppSpec = function(appDir, runAs, logDir, settings) {
  this.appDir = appDir;
  this.runAs = runAs;
  this.logDir = logDir;
  this.settings = settings;
};
module.exports = AppSpec;

(function() {

  this.getKey = function() {
    JSON.stringify(this);
  };

}).call(AppSpec.prototype);