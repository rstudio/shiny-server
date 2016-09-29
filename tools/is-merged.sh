#!/bin/bash

set -e

if [ "$1" == "" ] || [ "$2" == "" ]; then
  echo "Usage: is-merge.sh <source-ref> <target-ref>" 1>&2
  exit 127
fi

BASE=`git merge-base $1 $2`
REF=`git rev-parse $1`
if [ "$BASE" != "$REF" ]; then
  COUNT=`git log $BASE..$REF --pretty=oneline | wc -l`
  echo "$2 is $COUNT commit(s) behind $1" 1>&2
  exit 1
fi

