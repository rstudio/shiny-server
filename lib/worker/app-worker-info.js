var AppWorkerInfo = function(appSpec, listenPort, logFilePath, exitPromise) {
  this.appSpec = appSpec;
  this.listenPort = listenPort;
  this.logFilePath = logFilePath;
  this.exitPromise = exitPromise;
};
module.exports = AppWorkerInfo;

(function() {

}).call(AppWorkerInfo.prototype);