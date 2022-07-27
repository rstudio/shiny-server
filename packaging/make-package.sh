#!/usr/bin/env bash

set -e
set -x

env

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
	if which cmake3
	then
		CMAKE="cmake3"
	fi
fi

if [ "$CPACK" == "" ]
then
	CPACK="cpack"
	if which cpack3
	then
		CPACK="cpack3"
	fi
fi

DIR=`dirname $0`
cd "$DIR"
DIR=`pwd`
# Add node, etc. to the path
PATH=$DIR/../bin:$PATH
mkdir -p build
cd build
"$CMAKE" -DCMAKE_INSTALL_PREFIX=/opt ../..
make

# START: building in project root --------------------------
pushd ../..

./external/node/install-node.sh

# Install all dependencies and devDependencies--latter needed for `npm run build`
./bin/npm install
./bin/npm run build

# Remove devDependencies in preparation for building the installer
./bin/npm install --only=production

popd
# END: building in project root ----------------------------

"$CPACK" -G "$GENERATOR"

# Now that installer is built, install the devDependencies as well
(cd ../.. && ./bin/npm install)
