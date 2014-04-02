echo "deb http://cran.rstudio.com/bin/linux/ubuntu raring/" >> /etc/apt/sources.list

apt-get update

# --force-yes to handle the un-verified deb
apt-get install r-base-dev r-base -y --force-yes

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
