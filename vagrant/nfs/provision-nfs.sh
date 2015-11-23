#!/usr/bin/env bash

# install NFS server and export user home directories
apt-get install -y nfs-kernel-server
echo "/home/shiny   *(rw,sync,root_squash)" >> /etc/exports
service nfs-kernel-server start

# Create Shiny user
useradd -r -m shiny
mkdir /home/shiny/ShinyApps/
chown -R shiny:shiny /home/shiny
chmod 700 -R /home/shiny

# Install apps in Shiny user's personal dir
git clone https://github.com/rstudio/shiny.git
cp -R shiny/inst/examples/* /home/shiny/ShinyApps/

