#!/bin/sh
SHINYSERVERLIB=/usr/local/lib/shiny-server
mkdir -p $SHINYSERVERLIB
cp SockJSAdapter.R ${SHINYSERVERLIB}/
npm install
npm start
