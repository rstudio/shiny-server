#!/usr/bin/env bash

set -e

# Config variables.
# See e.g. https://nodejs.org/dist/v8.10.0/SHASUMS256.txt for checksum.
NODE_VERSION=8.11.3
NODE_SHA256=08e2fcfea66746bd966ea3a89f26851f1238d96f86c33eaf6274f67fce58421a

cd $(dirname $0)
cd ../..

check_node_needed () {
  if [ -x ext/node/bin/node ]
  then
    local CURRENT_NODE_VERSION=$(ext/node/bin/node --version 2>/dev/null)
    if [[ "$CURRENT_NODE_VERSION" == "v$NODE_VERSION" ]]
    then
      echo "Node v$NODE_VERSION is already installed, skipping" >&2
      exit 0
    fi
  fi
}

verify_checksum () {
  local FILE=$1
  local EXPECTED_CHECKSUM=$2

  local ACTUAL_CHECKSUM=$(sha256sum "$FILE")
  [[ "$EXPECTED_CHECKSUM  $FILE" != "$ACTUAL_CHECKSUM" ]]
}

download_node () {
  local NODE_FILENAME="node-v${NODE_VERSION}-linux-x64.tar.xz"
  local NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_FILENAME}"
  local NODE_ARCHIVE_DEST="/tmp/${NODE_FILENAME}"
  echo "Downloading Node v${NODE_VERSION} from ${NODE_URL}"

  wget -O "$NODE_ARCHIVE_DEST" "$NODE_URL"
  if verify_checksum "$NODE_ARCHIVE_DEST" "$NODE_SHA256"
  then
    echo "Checksum failed!" >&2
    exit 1
  fi

  mkdir -p ext/node
  echo "Extracting ${NODE_FILENAME}"
  tar xf "${NODE_ARCHIVE_DEST}" --strip-components=1 -C "ext/node"

  # Clean up temp file
  rm "${NODE_ARCHIVE_DEST}"

  cp ext/node/bin/node ext/node/bin/shiny-server
  rm ext/node/bin/npm
  (cd ext/node/lib/node_modules/npm && ./scripts/relocate.sh)
}

check_node_needed
download_node
