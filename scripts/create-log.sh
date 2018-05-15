#!/bin/bash

set -e

if [ $# -ne "2" ]; then
  echo "You must provide two arguments: the name of the log file and the mode"
  exit 1;
fi

LOGDIR=$(dirname "$1")

# Create directory if necessary. Will fail if it's a file.
echo "Creating directory $LOGDIR if it doesn't exist."
mkdir -p "$LOGDIR"

# Set desired mode
touch "$1"
chmod "$2" "$1"
