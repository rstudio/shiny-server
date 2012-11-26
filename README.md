# Shiny Server

[Shiny](http://shiny.rstudio.org/) makes it easy to write powerful, interactive applications in R. Shiny Server makes it easy to put Shiny apps on the web.

## Getting started

* Copy shiny-server.conf.sample to /etc/shiny-server.conf and modify it for your particular setup.
* Copy SockJSAdapter.R to /usr/local/lib/shiny-server/SockJSAdapter.R.
* Run `npm install`.
* Run `sudo npm start`.
