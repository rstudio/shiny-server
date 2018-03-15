project(node)

set(NODEJS_VERSION 8.10.0)
# See e.g. http://nodejs.org/dist/v0.10.21/SHASUMS.txt to find the appropriate
# hash value for the node-v0.10.21-linux-x64.tar.gz file.
set(NODEJS_SHA256 c1302439aee9791d70d3ab4194a612e6131d37fa0e3452072e847e212ed77867)

include(ExternalProject)

# Allow overriding of Python command used to build node.js (pass
# -DPYTHON=<path> to cmake).
if(NOT PYTHON)
  if(EXISTS /usr/bin/python26)
    # RedHat/CentOS 5 requires python26, because python means Python 2.4
    set(PYTHON python26)
  else()
    set(PYTHON python)
  endif()
endif()

get_filename_component(NODE_PREFIX 
                       "${CMAKE_CURRENT_SOURCE_DIR}/../../ext/node"
                       REALPATH)

execute_process(COMMAND "${CMAKE_CURRENT_SOURCE_DIR}/../../ext/node/bin/node" "--version"
  RESULT_VARIABLE NODEVER_EXIT
  OUTPUT_VARIABLE NODEVER
  OUTPUT_STRIP_TRAILING_WHITESPACE)

if (NOT NODEVER STREQUAL "v${NODEJS_VERSION}")
  # Download and build Node.js.
  # We copy bin/node to bin/shiny-server in order to make the process table
  # show "shiny-server" for our process.
  ExternalProject_Add(
    node
    URL http://nodejs.org/dist/v${NODEJS_VERSION}/node-v${NODEJS_VERSION}-linux-x64.tar.gz
    URL_HASH SHA256=${NODEJS_SHA256}
    DOWNLOAD_DIR download
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/node-v${NODEJS_VERSION}-linux-x64
    CONFIGURE_COMMAND echo pass
    BUILD_COMMAND echo pass
    INSTALL_COMMAND cp -R "${CMAKE_CURRENT_SOURCE_DIR}/node-v${NODEJS_VERSION}-linux-x64" "${NODE_PREFIX}" &&
                    cp "${NODE_PREFIX}/bin/node" "${NODE_PREFIX}/bin/shiny-server" &&
                    rm "${NODE_PREFIX}/bin/npm" &&
                    cd "${NODE_PREFIX}/lib/node_modules/npm" &&
                    ./scripts/relocate.sh
  )
endif()
