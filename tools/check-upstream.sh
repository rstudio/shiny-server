#!/bin/bash

cd "`dirname "$0"`"

grep -v '^\(#\|\s*$\)' ../upstream.txt | while read line
do
	echo "Upstream branch: $line"
	git fetch -q $line
	./is-merged.sh FETCH_HEAD HEAD
done
