#!/usr/bin/env bash

set -e

# This is needed for CentOS5/6 Jenkins workers to bootstrap the gcc-4.8 toolchain.

cd "$(dirname $0)"

if (which scl && scl -l | grep -q devtoolset-2);
then
	scl enable devtoolset-2 ./make-package.sh "$@"
else
	./make-package.sh "$@"
fi

