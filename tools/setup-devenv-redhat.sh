#!/usr/bin/env bash

set -e

cd "$(dirname $0)"

sudo yum update make gcc gcc-c++ git python openssl-devel

if ! hash cmake 2>/dev/null; then
	wget http://www.cmake.org/files/v2.8/cmake-2.8.11.2.tar.gz
	tar xzf cmake-2.8.11.2.tar.gz
	(cd cmake-2.8.11.2 && ./configure && make && sudo make install)
	rm -rf cmake-2.8.11.2
fi

./_setup-devenv-common.sh
