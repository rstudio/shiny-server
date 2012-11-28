# Shiny Server

[Shiny](http://shiny.rstudio.org/) makes it easy to write powerful, interactive applications in R. Shiny Server makes it easy to put Shiny apps on the web.

## Installing

* Copy config/shiny-server.conf.sample to /etc/shiny-server.conf and modify it for your particular setup.
* Copy config/SockJSAdapter.R to /usr/local/lib/shiny-server/SockJSAdapter.R.
* Run `sudo npm -g install`.

## Running from Upstart

For those UNIX systems that use the [Upstart](http://upstart.ubuntu.com/) init system:

* Copy config/upstart/shiny-server.conf to /etc/init/
* Run `sudo start shiny-server` to start and `sudo stop shiny-server` to stop.

The upstart script is set to start shiny-server on boot/reboot, and it will also
respawn shiny-server if it goes down.

## Running from the Command Line

* Run `sudo npm -g start shiny-server`.
