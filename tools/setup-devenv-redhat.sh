#!/usr/bin/env bash

set -e

cd "$(dirname $0)"

sudo yum install make gcc gcc-c++ git python openssl-devel cmake28

./_setup-devenv-common.sh
