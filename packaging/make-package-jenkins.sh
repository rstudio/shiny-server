#!/usr/bin/env bash

set -e
set -x

# This is needed for CentOS5/6 Jenkins workers to bootstrap a newer gcc toolchain.
cd "$(dirname $0)"

if (which scl && scl -l | grep -q devtoolset-11);
then
	CMAKE=cmake3 CPACK=cpack3 scl enable devtoolset-11 ./make-package.sh
else
	CC=gcc CXX=g++ ./make-package.sh "$@"
fi
