#!/usr/bin/env bash

set -e
set -x

env

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

if [ "$CMAKE" == "" ]
then
	CMAKE="cmake"
	if which cmake28
	then
		CMAKE="cmake28"
	fi
fi

if [ "$CPACK" == "" ]
then
	CPACK="cpack"
	if which cpack28
	then
		CPACK="cpack28"
	fi
fi

DIR=`dirname $0`
cd "$DIR"
DIR=`pwd`
mkdir -p build
cd build
"$CMAKE" -DCMAKE_INSTALL_PREFIX=/opt -DPYTHON="$PYTHON" ../..
make
(cd ../.. && bin/npm --python="$PYTHON" install)
"$CPACK" -G "$GENERATOR"

