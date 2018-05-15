#!/usr/bin/env bash

# Create Shiny user
useradd -r -m shiny
mkdir /home/shiny/ShinyApps/
chown -R shiny:shiny /home/shiny
chmod 755 -R /home/shiny

# install NFS server and export user home directories
apt-get install -y nfs-kernel-server
echo "/home/shiny   *(rw,sync,root_squash)" >> /etc/exports
service nfs-kernel-server restart

# Install apps in Shiny user's personal dir
git clone https://github.com/rstudio/shiny.git
cp -R shiny/inst/examples/* /home/shiny/ShinyApps/

