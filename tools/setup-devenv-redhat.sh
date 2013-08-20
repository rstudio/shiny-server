#!/usr/bin/env bash

set -e

cd "$(dirname $0)"

sudo yum update make gcc gcc-c++ git python26 openssl-devel cmake28

./_setup-devenv-common.sh