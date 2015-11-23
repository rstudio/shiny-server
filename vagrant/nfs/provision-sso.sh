#!/usr/bin/env bash

# install packages needed for development environment
apt-get install -y vim

# connect to NFS server already running on the primary machine
apt-get install -y nfs-common
mkdir -p /home/shiny
echo "192.168.42.102:/home /home/shiny/ nfs rsize=8192,wsize=8192,timeo=14,intr" >> /etc/fstab
mount -a 

wget https://s3.amazonaws.com/rstudio-shiny-server-os-build/ubuntu-12.04/x86_64/VERSION -O "version.txt"
VERSION=`cat version.txt`                                                          
                                                                                   
# Install the latest SSO build                                                     
wget "https://s3.amazonaws.com/rstudio-shiny-server-os-build/ubuntu-12.04/x86_64/shiny-server-$VERSION-amd64.deb" -O ss-latest.deb
                                                                                   
apt-get install gdebi -y                                                           
gdebi -n ss-latest.deb                                                             
                                                                                   
# R is too old for CRAN's latest Rcpp                                              
wget http://cran.r-project.org/src/contrib/Archive/Rcpp/Rcpp_0.10.5.tar.gz -O Rcpp_0.10.5.tar.gz
R CMD INSTALL Rcpp_0.10.5.tar.gz                                                   
                                                                                   
R -e "install.packages('shiny', repos='http://cran.rstudio.com/')"                 
                                                                                   
cp -R /usr/local/lib/R/site-library/shiny/examples/* /srv/shiny-server/

cp /shiny-server/vagrant/nfs/shiny-server.conf /etc/shiny-server/shiny-server.conf
restart shiny-server
