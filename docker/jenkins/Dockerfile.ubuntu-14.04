FROM ubuntu:14.04

# Setup, install tools for adding more repos

ENV DEBIAN_FRONTEND noninteractive

RUN apt-get update && apt-get install -y \
  python-software-properties \
  software-properties-common

# Install R repo

RUN echo 'deb http://cran.rstudio.com/bin/linux/ubuntu trusty/' >> /etc/apt/sources.list \
  && apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 0x51716619e084dab9

# Install Java 8 PPA

RUN apt-add-repository -y ppa:openjdk-r/ppa

# Install gcc 4.9 PPA

RUN add-apt-repository ppa:ubuntu-toolchain-r/test

# Install packages

RUN apt-get update && apt-get install -y \
  build-essential \
  cmake \
  curl \
  g++-4.9 \
  gcc-4.9 \
  git \
  libpam0g-dev \
  libssl-dev \
  make \
  openjdk-8-jdk \
  python \
  r-base \
  sudo \
  wget

# Set up gcc/g++

RUN update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-4.9 100 --slave /usr/bin/g++ g++ /usr/bin/g++-4.9

# Install cmake, do final setup

WORKDIR /tmp
RUN wget https://cmake.org/files/v2.8/cmake-2.8.11.2.tar.gz \
  && tar xzf cmake-2.8.11.2.tar.gz \
  && cd cmake-2.8.11.2 \
  && ./configure \
  && make \
  && make install

RUN ln -s /usr/bin/make /usr/bin/gmake

ARG JENKINS_GID=999
ARG JENKINS_UID=999
RUN groupadd -g $JENKINS_GID jenkins && \
    useradd -m -d /var/lib/jenkins -u $JENKINS_UID -g jenkins jenkins && \
    echo "jenkins ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers
