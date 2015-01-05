# Enable EPEL
rpm -Uvh http://mirror.pnl.gov/epel/7/x86_64/e/epel-release-7-2.noarch.rpm

# On this minimal install, we need wget
yum install wget -y

# Install R
yum install R -y

wget https://s3.amazonaws.com/rstudio-shiny-server-os-build/centos-6.3/x86_64/VERSION -O "version.txt"
VERSION=`cat version.txt`

# Install the latest SS build
wget "https://s3.amazonaws.com/rstudio-shiny-server-os-build/centos-6.3/x86_64/shiny-server-$VERSION-rh6-x86_64.rpm" -O ss-latest.rpm
yum install --nogpgcheck ss-latest.rpm -y

echo "password" | /opt/shiny-server/bin/sspasswd /etc/shiny-server/passwd "admin"

sudo su - \
    -c "R -e \"install.packages('shiny', repos='http://cran.rstudio.com/')\""

sudo cp -R /usr/lib64/R/library/shiny/examples/* /srv/shiny-server/

systemctl disable firewalld 
systemctl stop firewalld
sed -i 's/enforcing/disabled/g' /etc/selinux/config
