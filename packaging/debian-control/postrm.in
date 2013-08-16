#!/bin/sh

# errors shouldn't cause script to exit
set +e

rm -f /usr/bin/shiny-server
rm -f /etc/init/shiny-server.conf

# remove temporary sockets
rm -rf /var/shiny-server/sockets

# clear error termination state
set -e
