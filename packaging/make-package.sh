#!/usr/bin/env bash

set -e

if [ "$1" != "DEB" -a "$1" != "RPM" ]
then
	echo "Usage: make-package.sh [DEB|RPM]"
	exit 1
fi

DIR=`dirname $0`
cd "$DIR"
DIR=`pwd`
mkdir -p build
cd build
cmake --prefix=/opt/shiny-server ../..
make
(cd ../.. && bin/npm install)
cpack -G "$1"

