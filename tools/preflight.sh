#!/bin/bash

cd `dirname "$0"`
cd ..

echo Checking dependency licenses >&2
bin/node tools/check-licenses.js

echo Checking for unmerged changes from upstream >&2
tools/check-upstream.sh
