#!/usr/bin/env bash

set -e

# connect to NFS server already running on the primary machine
apt-get install -y nfs-common
mkdir -p /home/shiny
echo "192.168.42.102:/home/shiny /home/shiny/ nfs rsize=8192,wsize=8192,timeo=14,intr" >> /etc/fstab
mount -a 

# Install SSP to get the shiny user and config files, etc.
wget -q https://s3.amazonaws.com/rstudio-shiny-server-os-build/ubuntu-14.04/x86_64/VERSION -O "version.txt"
VERSION=`cat version.txt`

apt-get install -y gdebi-core

# Install the latest SSP build
wget -q "https://s3.amazonaws.com/rstudio-shiny-server-os-build/ubuntu-14.04/x86_64/shiny-server-$VERSION-amd64.deb" -O ssp-latest.deb
gdebi -n ssp-latest.deb

R -e "install.packages('shiny', repos='http://cran.rstudio.com/')"                 
                                                                                   
cp -R /usr/local/lib/R/site-library/shiny/examples/* /srv/shiny-server/

cp /shiny-server/vagrant/nfs/shiny-server.conf /etc/shiny-server/shiny-server.conf
systemctl restart shiny-server
