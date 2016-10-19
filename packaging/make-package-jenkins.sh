#!/usr/bin/env bash

set -e

# This is needed for CentOS5/6 Jenkins workers to bootstrap the gcc-4.8 toolchain.

cd "$(dirname $0)"

# This will set up two global variables: NODE_ARCHIVE_FILENAME and SAVE_NODE_BUILD.
init_nodejs_vars() {
  local NODE_VER=`grep 'set(NODEJS_VERSION' ../external/node/CMakeLists.txt | sed 's/[^0-9.]//g'`
  # Expect node version to be x.y.z format
  if ! [[ "$NODE_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Couldn't parse node version" >&2
    exit 1
  fi

  if [ "$OS" == "" ]; then
    echo "Missing 'OS' Jenkins environment variable" >&2
    exit 1
  fi

  if [ "$ARCH" == "" ]; then
    echo "Missing 'ARCH' Jenkins environment variable" >&2
    exit 1
  fi

  # The filename of a suitable cached build of Node.js. We will either download
  # and use such a file from S3, or, we will build from source and create this
  # file (and expect Jenkins to upload it).
  NODE_ARCHIVE_FILENAME="node_${NODE_VER}_${OS}_${ARCH}.tar.gz"

  # If 1, then after we build, we'll want to save the ext/node directory as a
  # .tar.gz in the packaging/build directory. Jenkins will see to getting it
  # uploaded to S3. The setup_cached_nodejs step will set this to 0 if it finds
  # a cached build already present on S3.
  SAVE_NODE_BUILD=1
}

# Attempt to retrieve a cached Node.js build from S3. If one is found, then we
# will unpack it in ../ext and set SAVE_NODE_BUILD=0.
setup_cached_nodejs () {
  # This is the URL where we'll expect to find a suitable cached build of Node.js, if one exists
  local NODE_ARCHIVE_URL="https://s3.amazonaws.com/rstudio-shiny-server-os-build/node/${NODE_ARCHIVE_FILENAME}"
  # The local path where we'll put the cached build, if we can find it
  local NODE_ARCHIVE_DEST="../ext/${NODE_ARCHIVE_FILENAME}"

  wget -O "${NODE_ARCHIVE_DEST}" "${NODE_ARCHIVE_URL}" || rm -f "${NODE_ARCHIVE_DEST}"
  if [ -f "${NODE_ARCHIVE_DEST}" ]; then
    SAVE_NODE_BUILD=0
    echo "Using cached Node.js build from $NODE_ARCHIVE_URL" >&2
    (cd ../ext && tar xzf "$NODE_ARCHIVE_FILENAME" && rm "$NODE_ARCHIVE_FILENAME")
  else
    echo "No cached Node.js build found; will build from source (tried $NODE_ARCHIVE_URL)" >&2
  fi
}

# If SAVE_NODE_BUILD=1, then tar-gzip ext/node and put it in packaging/build.
archive_nodejs() {
  if [ "$SAVE_NODE_BUILD" == "1" ]; then
    echo "Saving node build as $NODE_ARCHIVE_FILENAME" >&2
    (cd ../ext && tar czf "../packaging/build/$NODE_ARCHIVE_FILENAME" node)
  fi
}


init_nodejs_vars
setup_cached_nodejs

if (which scl && scl -l | grep -q devtoolset-2);
then
	scl enable devtoolset-2 ./make-package.sh "$@"
else
	CC=gcc-4.8 CXX=g++-4.8 ./make-package.sh "$@"
fi

archive_nodejs
