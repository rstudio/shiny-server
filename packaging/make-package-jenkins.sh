#!/usr/bin/env bash

set -e
set -x

cd "$(dirname $0)"

# Node 24's headers compile addons with -std=gnu++20, which needs gcc 10+.
# The build images' stock compilers are older (gcc 9 on Ubuntu 20.04, gcc 8
# on Rocky 8), so prefer the newer one each image installs alongside it.
if [ -f /opt/rh/gcc-toolset-13/enable ]; then
	source /opt/rh/gcc-toolset-13/enable
	CC=gcc CXX=g++ ./make-package.sh "$@"
elif which g++-10; then
	CC=gcc-10 CXX=g++-10 ./make-package.sh "$@"
else
	CC=gcc CXX=g++ ./make-package.sh "$@"
fi

if [[ $(git diff --stat) != '' ]]; then
  echo "Repo is dirty, possibly tsc output was not checked in?" >&2
	git status >&2
	exit 1
fi