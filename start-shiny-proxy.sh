#!/bin/sh
SHINYPROXYLIB=/usr/local/lib/shiny-proxy
mkdir -p $SHINYPROXYLIB
cp SockJSAdapter.R ${SHINYPROXYLIB}/
npm start
