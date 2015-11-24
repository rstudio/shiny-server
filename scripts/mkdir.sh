#!/bin/bash

set -e 

if [ $# -ne "3" ]; then
  echo "You must provide two arguments: the name of the directory, the user name, and the group name"
  exit 1;
fi

# Create a directory and check its ownership
echo "Creating directory $1 if it doesn't exist."
[ -d "$1" ] || mkdir "$1"

echo "Chmodding to 755"
chmod 755 "$1"

echo "Chowning directory $1 to $2:$3"
chown "$2":"$3" "$1"

if [ ! -d "$1" ]; then
  echo "The given path is not a directory."
  exit 1;
fi
