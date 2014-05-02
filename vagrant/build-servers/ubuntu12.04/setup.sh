echo "deb http://cran.rstudio.com/bin/linux/ubuntu precise/" >> /etc/apt/sources.list

apt-get update

# --force-yes to handle the un-verified deb
apt-get install r-base-dev r-base -y --force-yes

apt-get install gdebi git gcc g++ -y

# R is too old for CRAN's latest Rcpp
wget http://cran.r-project.org/src/contrib/Archive/Rcpp/Rcpp_0.10.5.tar.gz -O Rcpp_0.10.5.tar.gz
R CMD INSTALL Rcpp_0.10.5.tar.gz

R -e "install.packages('shiny', repos='http://cran.rstudio.com/')"

mkdir -p /srv/shiny-server

cp -R /usr/local/lib/R/site-library/shiny/examples/* /srv/shiny-server/

# Get and build cmake
wget http://www.cmake.org/files/v2.8/cmake-2.8.11.2.tar.gz
tar xzf cmake-2.8.11.2.tar.gz
cd cmake-2.8.11.2
./configure
make
make install

