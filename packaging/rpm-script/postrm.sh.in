#!/bin/sh

# errors shouldn't cause script to exit
set +e

if [ "$1" = "0" ] ; then
    # uninstall
    rm -f /usr/bin/shiny-server
    rm -f /etc/init/shiny-server.conf
    rm -f /etc/systemd/system/shiny-server.service
    rm -f /etc/init.d/shiny-server

    # remove temporary sockets
    rm -rf /var/shiny-server/sockets
fi

# clear error termination state
set -e
