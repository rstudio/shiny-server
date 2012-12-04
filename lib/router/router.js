var AppSpec = require('../worker/app-spec');

exports.DummyRouter = DummyRouter;
function DummyRouter(appDir, runAs) {
  this.appSpec = new AppSpec(appDir, runAs, null, {});
}

(function() {
  this.getAppSpec = function(url) {
    return this.appSpec;
  };
}).call(DummyRouter.prototype);
