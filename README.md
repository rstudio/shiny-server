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

* [Node.js 0.8.16 or later](http://nodejs.org) (for Ubuntu, we have found [these instructions](https://github.com/joyent/node/wiki/Installing-Node.js-via-package-manager) to work well)
* [R 2.15 or later](http://www.r-project.org)
* [Shiny](https://github.com/rstudio/shiny) R package, installed by root

## Installing

* Run as root (or `sudo`): `npm -g install shiny-server`
* Optional: Create a config file (see below).

## Quick start

Run as root (or `sudo`):

```
# Create a user to run Shiny apps under
useradd --system shiny
# Create a root directory for your website
mkdir -p /var/shiny-server/www
# Create a directory for application logs
mkdir -p /var/shiny-server/log
```

Next, copy your app directory to the website root, but append `.shiny` to the directory name. (This is very important! If the application folder does not end with `.shiny` it will be deployed as static assets, not a Shiny application!)
```
sudo cp -R ~/MY-APP /var/shiny-server/www/MY-APP.shiny
```

Finally, start Shiny Server:
```
sudo shiny-server
```

Now start a web browser and point it to `http://localhost:3838/MY-APP/`. (Notice that ".shiny" does not appear in the URL.)

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

By default, Shiny Server will look for a config file at `/etc/shiny-server/shiny-server.conf`; if no file is found, a default configuration will be used.

Shiny Server offers three distinct ways of deploying applications:

* **Serve up a directory which can contain a combination of static assets (HTML files, images, PDFs, etc.), Shiny applications, and subdirectories.** Any subdirectory name that ends with `.shiny` is assumed to be a Shiny application directory. For example, if `/var/shiny-server/www` is your root dir and `/var/shiny-server/www/sales/historical.shiny` contains a Shiny application, then the URL for that application would be `http://hostname:port/sales/historical/`.
* **Configure a URL path to be "autouser"; any user with a home directory on the system can deploy applications simply by creating a `~/ShinyApp` directory and placing their Shiny applications in direct subdirectories.** For example, if `/users` is configured to be an autouser path, and the user `jeffreyhorner` creates a folder `~/ShinyApps/testapp` that contains a `server.R` and a `ui.R` file, then browsing to `http://hostname/users/jeffreyhorner/testapp/` would automatically load that application.
* **Explicitly declare one or more applications in the configuration file.** For each individual application you can specify the URL, application directory path, log directory, and which user to run the application as.

A single Shiny Server instance can host zero or more explicitly-declared applications and zero or more autouser URLs at the same time; you don't need to choose one or the other.

Here is a minimal configuration file for a server that only does autouser hosting:

```
server {
  # The TCP/IP port to listen on
  listen 80;
  
  # Configure the root URL to be autouser
  location / {
    user_apps on;
  }
}
```

Here is a minimal configuration file for a server that is backed by a directory that contains a combination of static assets and Shiny applications:

```
# By default, use the 'shiny' user to run the applications; this
# user should have the minimum amount of privileges necessary to
# successfully run the applications (i.e. read-only access to the
# site dir).
run_as shiny;

# The directory where application log files should be written to.
# This directory must exist--it will NOT be automatically created.
log_dir /var/log/shiny-server/apps/;

server {
  listen 80;

  location / {
    site_dir /var/shiny-www;
  }
}
```

Here is a simple configuration file for a server that hosts two apps:

```
# By default, use the 'shiny' user to run the applications; this
# user should have the minimum amount of privileges necessary to
# successfully run the applications (i.e. read-only access to the
# Shiny app dirs).
run_as shiny;

# The directory where application log files should be written to.
# This directory must exist--it will NOT be automatically created.
log_dir /var/log/shiny-server/apps/;

server {
  listen 80;
  
  location /app1 {
    app_dir /var/shiny-apps/app1;
  }
  
  location /app2 {
    app_dir /var/shiny-apps/app2;
  }
}
```

You can have multiple `location` directives per `server` block, and they don't need to all be of the same kind; you can easily incorporate all three hosting models in the same server instance.

```
run_as shiny;
log_dir /var/log/shiny-server/log/;

server {
  listen 80;

  location /users {
    user_apps on;
  }

  location /dashboard {
    app_dir /var/dashboard/shinyapp;
  }

  location / {
    site_dir /var/shiny-server/www;
  }
}
```

<!--
```
server {
  listen 80;  # The TCP/IP port this server should listen on
  
  # Configure http://hostname/users
  location /users {
  	# Make this path autouser
  	user_apps on;
  	
  	# Uncomment the following line to require users to be a member
  	# of either the "shiny-users" or "power-users" groups
  	#
  	# members_of shiny-users power-users;
  }
  
  # Declare a Shiny application at http://hostname/app1
  location /app1 {
    # The path to the Shiny application directory
    app_dir /var/shiny-apps/app1;
    
    # The user the app should be run as. This user should have the
    # minimal amount of privileges necessary to successfully run
    # the application (i.e. read-only access to the Shiny app dir).
    run_as shiny;
    
    # The directory this application's logs should be written to.
    # You can have multiple applications configured with the same
    # log directory; the log filenames differ by application and
    # user.
    log_dir /var/log/shiny-apps/
  }
}
```
-->

## Contact

Please direct questions to the [shiny-discuss](https://groups.google.com/group/shiny-discuss) group.
