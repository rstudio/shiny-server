# This box didn't include root in 'sudoers', so any command with 'sudo' would fail 
# (since it runs as root). Add root to approved sudoers list so it's not a problem.
echo "root            ALL=(ALL)               NOPASSWD: ALL" >> /etc/sudoers

# IPTables is enabled on this box by default. Stop.
sudo /etc/init.d/iptables stop
sudo chkconfig iptables off

# Enable EPEL
rpm -Uvh http://download.fedoraproject.org/pub/epel/6/x86_64/epel-release-6-8.noarch.rpm

# Install R
yum install R -y

wget https://s3.amazonaws.com/rstudio-shiny-server-os-build/centos-6.3/x86_64/VERSION -O "version.txt"
VERSION=`cat version.txt`

# Install the latest SSP build
wget "https://s3.amazonaws.com/rstudio-shiny-server-os-build/centos-6.3/x86_64/shiny-server-$VERSION-x86_64.rpm" -O ss-latest.rpm
yum install --nogpgcheck ss-latest.rpm -y

sudo su - \
    -c "R -e \"install.packages('shiny', repos='http://cran.rstudio.com/')\""

sudo cp -R /usr/lib64/R/library/shiny/examples/* /srv/shiny-server/
