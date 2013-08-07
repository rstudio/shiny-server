project(node)

include(ExternalProject)

get_filename_component(NODE_PREFIX 
                       "${CMAKE_CURRENT_SOURCE_DIR}/../../bin/node"
                       REALPATH)

ExternalProject_Add(
  node
  URL /Users/jcheng/Downloads/node-v0.10.15.tar.gz
  URL_MD5 59f295b0a30dc8dbdb46407c2d9b2923
  DOWNLOAD_DIR download
  SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/node-v0.10.15
  BUILD_IN_SOURCE 1
  CONFIGURE_COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/node-v0.10.15/configure "--prefix=${NODE_PREFIX}"
  BUILD_COMMAND make -j4
  INSTALL_COMMAND make install
)