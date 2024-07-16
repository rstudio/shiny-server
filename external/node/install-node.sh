#!/usr/bin/env bash

set -e

cd $(dirname $0)
cd ../..

NODE_VERSION=$(cat .nvmrc)

check_node_needed () {
  if [ -x ext/node/bin/node ]
  then
    local CURRENT_NODE_VERSION=$(ext/node/bin/node --version 2>/dev/null)
    if [[ "$CURRENT_NODE_VERSION" == "$NODE_VERSION" ]]
    then
      echo "Node $NODE_VERSION is already installed, skipping" >&2
      exit 0
    fi
  fi
}

download_node () {
  # Determine the operating system
  local OS_TYPE=$(uname -s)
  case "$OS_TYPE" in
      Linux*)     OS=linux;;
      Darwin*)    OS=darwin;;
      CYGWIN*|MINGW*|MSYS*) OS=win;;
      AIX*)       OS=aix;;
      *)          echo "Error: Unknown operating system: $OS_TYPE"; exit 1;;
  esac

  # Determine the architecture
  local ARCH_TYPE=$(uname -m)
  case "$ARCH_TYPE" in
      x86_64)     ARCH=x64;;
      arm64)      ARCH=arm64;;
      aarch64)    ARCH=arm64;;
      armv7l)     ARCH=armv7l;;
      ppc64le)    ARCH=ppc64le;;
      i[3456]86)  ARCH=x86;;
      s390x)      ARCH=s390x;;
      *)          echo "Error: Unknown architecture: $ARCH_TYPE"; exit 1;;
  esac

  local NODE_FILENAME="node-${NODE_VERSION}-${OS}-${ARCH}.tar.xz"
  local NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_FILENAME}"
  local NODE_ARCHIVE_DEST="/tmp/${NODE_FILENAME}"
  echo "Downloading Node ${NODE_VERSION} from ${NODE_URL}"

  wget -O "$NODE_ARCHIVE_DEST" "$NODE_URL"

  rm -rf ext/node
  mkdir -p ext/node
  echo "Extracting ${NODE_FILENAME}"
  tar xf "${NODE_ARCHIVE_DEST}" --strip-components=1 -C "ext/node"

  # Clean up temp file
  rm "${NODE_ARCHIVE_DEST}"

  cp ext/node/bin/node ext/node/bin/shiny-server
  rm ext/node/bin/npm
}

check_node_needed
download_node
