#!/bin/bash

if [ $# -lt 1 ]; then
   cmd='list'
else
   cmd=$1
fi


lsof -np `ps ax | grep 'node /usr/bin/shiny-server' | grep -v grep | awk '{print $1}'` | grep TCP | grep "127.0.0.1" | awk '{print $9}' | awk -F: '{print $3}' | sort -u > /tmp/shiny-server-ports.$$.txt

for i in `ps ax | grep /usr/lib/R/bin/exec/R | grep SockJS | grep -v grep | awk '{print $1}'`; do lsof -p $i | grep LIST | awk '{print $2,$9}' | sed -e 's/[*:]//g'; done | sort > /tmp/shiny-r-procs-ports.$$.txt

for i in `cat /tmp/shiny-server-ports.$$.txt`; do grep $i /tmp/shiny-r-procs-ports.$$.txt; done | sort > /tmp/shiny-r-procs-ports-connected.$$.txt

list_app (){
   local user=$(ls -ld /proc/"$1" | awk '{print $3}')
   local start=$(ls -ld /proc/"$1" | awk '{print $6, $7, $8}')
   local cwd=$(ls -l /proc/"$1" | grep cwd | awk '{print $11}')
   local app=$(basename "$cwd")
   echo $start $1 $user-$app
}

case "$cmd" in

list)
   echo
   echo ORPHANS
   echo
   for i in `comm -2 -3 /tmp/shiny-r-procs-ports.$$.txt /tmp/shiny-r-procs-ports-connected.$$.txt | awk '{print $1}'`; do list_app "$i"; done
   echo
   echo CONNECTED
   echo
   for i in `cat /tmp/shiny-r-procs-ports-connected.$$.txt | awk '{print $1}'`; do list_app "$i"; done
;;

kill)
   for i in `comm -2 -3 /tmp/shiny-r-procs-ports.$$.txt /tmp/shiny-r-procs-ports-connected.$$.txt | awk '{print $1}'`; do kill -INT ${i}; done
;;

esac

/bin/rm -f /tmp/*${$}.txt
