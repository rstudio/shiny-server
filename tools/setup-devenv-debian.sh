#!/usr/bin/env bash

set -e

cd "$(dirname $0)"

sudo apt-get install make gcc g++ git python libssl-dev cmake

./_setup-devenv-common.sh