#!/usr/bin/env bash

set -e

# add repo for R 
apt-key adv --keyserver keyserver.ubuntu.com --recv-keys E084DAB9
echo "deb https://cran.rstudio.com/bin/linux/ubuntu xenial/" >> /etc/apt/sources.list

# bring apt database up to date with R packages
apt-get update

# install R
apt-get install -y --force-yes r-base r-base-dev

# install minimal packages needed to run bootstrap scripts
apt-get install -y unzip
apt-get install -y git
apt-get install -y g++
apt-get install -y wget

# install packages needed to build and run devtools
apt-get install -y libssh2-1-dev
apt-get install -y curl 
apt-get install -y libcurl4-openssl-dev


