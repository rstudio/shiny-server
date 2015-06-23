#!/bin/sh

# errors shouldn't cause script to exit
set +e

if [ "$1" = "0" ] ; then
    # uninstall
    rm -f /usr/bin/shiny-server
    rm -f /etc/init/shiny-server.conf

    # remove temporary sockets
    rm -rf /var/shiny-server/sockets
fi

# clear error termination state
set -e
