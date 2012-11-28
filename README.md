# Shiny Server

[Shiny](http://shiny.rstudio.org/) makes it easy to write powerful, interactive applications in R. Shiny Server is a server program that makes Shiny applications available over the web.

## Features

* Any user on the system can create and deploy their own Shiny applications
* Supports non-websocket-capable browsers, like IE8/9
* Free and open source (AGPL-3 license)
* **Experimental quality. Use at your own risk!**

## System Requirements

* [NodeJS 0.8.5 or later](https://github.com/joyent/node/wiki/Installing-Node.js-via-package-manager)
* Linux, for now
* R 2.15 or later
* [Shiny](https://github.com/rstudio/shiny) R package, installed by root

## Installing

* `sudo npm -g install shiny-server`
* [Optional] Copy config/config.sample to /etc/shiny-server/config and modify it for your particular setup. If you skip this step, sensible defaults will be used (note: port 80 will be used by default).

## Running from Upstart

For those UNIX systems that use the [Upstart](http://upstart.ubuntu.com/) init system, such as RHEL/CentOS 6+ and Ubuntu:

* Copy config/upstart/shiny-server.conf to /etc/init/
* Run `sudo start shiny-server` to start and `sudo stop shiny-server` to stop.

The upstart script is set to start shiny-server on boot/reboot, and it will also
respawn shiny-server if it goes down.

## Running from the Command Line

* Run `sudo shiny-server`.

## How to Use

Once Shiny Server is installed and running, any user account on the server can create a Shiny app by going to his or her home directory, creating a `ShinyApps` subdirectory, and placing Shiny app directories under `ShinyApps`.

For example, if the user `jeffreyhorner` creates a folder `~/ShinyApps/testapp` that contains a `server.R` and a `ui.R` file, then browsing to `http://hostname/jeffreyhorner/testapp/` would automatically load that application.

## Contact

Please direct questions to the [shiny-discuss](https://groups.google.com/group/shiny-discuss) group.