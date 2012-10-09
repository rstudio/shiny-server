#!/bin/sh
SHINYPROXYLIB=/usr/local/lib/shiny-proxy
mkdir -p $SHINYPROXYLIB
cp SockJSAdapter.R ${SHINYPROXYLIB}/
node shiny-proxy-2.js
