#!/usr/bin/env bash

set -e

CMAKE=cmake
if hash cmake28 2>/dev/null; then
   CMAKE=cmake28
fi

cd "$(dirname $0)"

# See if "shiny" user exists
if id -u shiny >/dev/null 2>&1;
then
   echo User "shiny" already exists
else
   echo Creating user "shiny"
   sudo useradd -r -m shiny
fi

sudo mkdir -p /var/log/shiny-server
sudo mkdir -p /srv/shiny-server

# Log dir must be writable by "shiny" user
sudo chown shiny:shiny /var/log/shiny-server

mkdir -p build
(cd build && "$CMAKE" ../.. && make)

(cd .. && bin/npm install)
