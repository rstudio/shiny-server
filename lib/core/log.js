var log4js = require('log4js');

global.logger = log4js.getLogger('shiny-server');
global.logger.setLevel(process.env.SHINY_LOG_LEVEL || 'INFO');