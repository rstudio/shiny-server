#!/bin/bash

set -e

# Get the shiny-server directory
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && cd .. && pwd )"

if [ $# -eq 0 ]
then
  echo "No test config name supplied, using \"testapps\"" >&2
  TEST="testapps"
else
  # The name of the config template in test/configs (e.g. "testapps" for testapps.config.in)
  TEST="$1"
  shift
fi

CONFIG_IN="$ROOT/test/configs/$TEST.config.in"
mkdir -p /tmp/shiny-server-test
CONFIG_OUT="/tmp/shiny-server-test/$TEST.config"
(sed -e "s/\$USER/$USER/g" | sed -e "s/\$ROOT/$(echo $ROOT | sed -e 's/[\/&]/\\&/g')/g") < "$CONFIG_IN" > "$CONFIG_OUT"

"$ROOT/bin/shiny-server" $CONFIG_OUT $@
