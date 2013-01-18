# Shiny Server

Shiny Server is a server program that makes [Shiny](http://shiny.rstudio.org/) applications available over the web.

## Features

* Host multiple Shiny applications, each with its own URL
* Can be configured to allow any user on the system to create and deploy their own Shiny applications
* Supports non-websocket-capable browsers, like IE8/9
* Free and open source ([AGPLv3](http://www.gnu.org/licenses/agpl-3.0.html) license)
* **Experimental quality. Use at your own risk!**

## Prerequisites

A Linux server, with the following installed:

* [Node.js 0.8.16 or later](http://nodejs.org)
  * For Ubuntu, we have found [these instructions](https://github.com/joyent/node/wiki/Installing-Node.js-via-package-manager) to work well.
  * For Red Hat/CentOS, we recommend [installing from source](https://github.com/joyent/node/wiki/Installation).
* [R 2.15 or later](http://www.r-project.org)
* [Shiny](https://github.com/rstudio/shiny) R package, installed into the site-wide library. This is one easy way to do that:<br/>
```
sudo su - -c "R -e \"install.packages('shiny', repos='http://cran.rstudio.com/')\""
```

## Installing

* Run as root (or `sudo`): `npm install -g shiny-server`
* Optional: Create a config file (see below).

## Quick start

Run as root (or `sudo`):

```
# Create a system account to run Shiny apps
useradd -r shiny
# Create a root directory for your website
mkdir -p /var/shiny-server/www
# Create a directory for application logs
mkdir -p /var/shiny-server/log
```

Next, copy your app directory to the website root:
```
sudo cp -R ~/MY-APP /var/shiny-server/www/
```

Finally, start Shiny Server:
```
sudo shiny-server
```

Now start a web browser and point it to `http://<hostname>:3838/MY-APP/`

**If the browser is not able to connect to the server, configure your server's firewall to allow inbound TCP connections on port 3838.**

To customize any of the above, or to explore the other ways Shiny Server can host Shiny apps, see the [Configuration](#configuration) section below.

## Running from the Command Line

* Run `sudo shiny-server`
* Optionally, you can pass a custom configuration file path (see below) as a parameter. Otherwise, `/etc/shiny-server/shiny-server.conf` will be assumed as the config file path.

## Running from Upstart

For those UNIX systems that use the [Upstart](http://upstart.ubuntu.com/) init system, such as RHEL/CentOS 6+ and Ubuntu:

* Copy config/upstart/shiny-server.conf to /etc/init/
* Run `sudo start shiny-server` to start and `sudo stop shiny-server` to stop.
* Run `sudo reload shiny-server` to re-read the config file without needing to restart the server.

The upstart script is set to start shiny-server on boot/reboot, and it will also
respawn shiny-server if it goes down.

## Configuration

See the document <a href="http://htmlpreview.github.com/?https://github.com/rstudio/shiny-server/blob/master/config.html">Shiny Server Configuration Reference</a> for details.

## Contact

Please direct questions to the [shiny-discuss](https://groups.google.com/group/shiny-discuss) group.
