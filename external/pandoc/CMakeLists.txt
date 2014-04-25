project(pandoc)

set(PANDOC_VERSION 1.12.3)

include (ExternalProject)

get_filename_component(PANDOC_PREFIX 
                       "${CMAKE_CURRENT_SOURCE_DIR}/../../ext/pandoc"
                       REALPATH)

# Detect distribution
if(EXISTS "/etc/debian_version")
  set(DISTRIBUTION debian)
  set(PANDOC_SHA1 11f65f5c35d7525dc4c40acf6019fb19a4b48c7e)
endif()

if(EXISTS "/etc/redhat-release")
  set(DISTRIBUTION rpm)
  set(PANDOC_SHA1 11f65f5c35d7525dc4c40acf6019fb19a4b48c7e)
endif()

set(MY_DOWNLOAD_PATH "${CMAKE_CURRENT_BINARY_DIR}/pandoc-${PANDOC_VERSION}.zip")

# Download and copy Pandoc
#ExternalProject_Add(
#  pandoc
#  URL http://s3.amazonaws.com/rstudio-buildtools/pandoc-${PANDOC_VERSION}.zip
#  URL_HASH SHA1=${PANDOC_SHA1}
#  DOWNLOAD_DIR download
#  SOURCE_DIR ${CMAKE_CURRENT_BINARY_DIR}
#  BUILD_IN_SOURCE 1
#  CONFIGURE_COMMAND ""
#  BUILD_COMMAND ""
#  INSTALL_COMMAND unzip -j ${MY_DOWNLOAD_PATH} pandoc-${PANDOC_VERSION}/linux/${DISTRIBUTION}/x86_64/pandoc -d ${PANDOC_PREFIX}/pandoc/ &&
#                  chmod +x ${PANDOC_PREFIX}/pandoc*
#)

#

if (NOT EXISTS "${MY_DOWNLOAD_PATH}")
    file(DOWNLOAD "http://s3.amazonaws.com/rstudio-buildtools/pandoc-${PANDOC_VERSION}.zip" "${MY_DOWNLOAD_PATH}" 
    EXPECTED_MD5 1541304bf51d86e361b7d930f899ac1c)
endif()

execute_process(
    COMMAND unzip -u -j ${MY_DOWNLOAD_PATH} pandoc-${PANDOC_VERSION}/linux/${DISTRIBUTION}/x86_64/pandoc -d ${CMAKE_SOURCE_DIR}/ext/pandoc
    DEPENDS "${MY_DOWNLOAD_PATH}")

execute_process(
    COMMAND unzip -u -j ${MY_DOWNLOAD_PATH} pandoc-${PANDOC_VERSION}/linux/${DISTRIBUTION}/x86_64/pandoc-citeproc -d ${CMAKE_SOURCE_DIR}/ext/pandoc
    DEPENDS "${MY_DOWNLOAD_PATH}")    
