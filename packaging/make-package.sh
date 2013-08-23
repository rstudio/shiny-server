#!/usr/bin/env bash

set -e

if [ "$PYTHON" == "" ]
then
	# python26 is required for RedHat/CentOS 5
	if [ -x /usr/bin/python26 ]
	then
		PYTHON=python26
	else
		PYTHON=python
	fi
fi

GENERATOR="$1"
if [ "$GENERATOR" == "" ]
then
	if [ -f /etc/debian_version ]; then
		GENERATOR=DEB
	fi
	if [ -f /etc/redhat-release ]; then
		GENERATOR=RPM
	fi
fi

if [ "$GENERATOR" != "DEB" -a "$GENERATOR" != "RPM" ]
then
	echo "Usage: make-package.sh [DEB|RPM]"
	exit 1
fi

DIR=`dirname $0`
cd "$DIR"
DIR=`pwd`
mkdir -p build
cd build
cmake -DCMAKE_INSTALL_PREFIX=/opt -DPYTHON="$PYTHON" ../..
make
(cd ../.. && bin/npm --python="$PYTHON" install)
cpack -G "$1"

