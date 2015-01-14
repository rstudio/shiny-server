project(pandoc)

set(PANDOC_VERSION 1.12.3)

get_filename_component(PANDOC_PREFIX 
                       "${CMAKE_CURRENT_SOURCE_DIR}/../../ext/pandoc"
                       REALPATH)

set(PANDOC_SHA1 11f65f5c35d7525dc4c40acf6019fb19a4b48c7e)

set(MY_DOWNLOAD_PATH "${CMAKE_CURRENT_BINARY_DIR}/pandoc-${PANDOC_VERSION}.zip")

if (NOT EXISTS "${MY_DOWNLOAD_PATH}")
    file(DOWNLOAD "http://s3.amazonaws.com/rstudio-buildtools/pandoc-${PANDOC_VERSION}.zip" "${MY_DOWNLOAD_PATH}" 
    EXPECTED_MD5 1541304bf51d86e361b7d930f899ac1c)
endif()

execute_process(
    COMMAND mkdir -p ${PANDOC_PREFIX}
    DEPENDS "${MY_DOWNLOAD_PATH}")

# Detect distribution
if(EXISTS "/etc/debian_version")
  set(DISTRIBUTION debian)
    # Then we'll want the dynamic versions
    execute_process(
        COMMAND unzip -u -j ${MY_DOWNLOAD_PATH} pandoc-${PANDOC_VERSION}/linux/${DISTRIBUTION}/x86_64/pandoc -d ${PANDOC_PREFIX}
        DEPENDS "${MY_DOWNLOAD_PATH}")
    
    execute_process(
        COMMAND unzip -u -j ${MY_DOWNLOAD_PATH} pandoc-${PANDOC_VERSION}/linux/${DISTRIBUTION}/x86_64/pandoc-citeproc -d ${PANDOC_PREFIX}
        DEPENDS "${MY_DOWNLOAD_PATH}")
endif()

if(EXISTS "/etc/redhat-release")
  set(DISTRIBUTION rpm)

  execute_process(
    COMMAND sed -nr "s/.*release\\ ([0-9]).*/\\1/p" /etc/redhat-release
    OUTPUT_VARIABLE REDHAT_VER)

  if (${REDHAT_VER} EQUAL "5")
    # Need the dynamic versions of pandoc.
    execute_process(
        COMMAND unzip -u -j ${MY_DOWNLOAD_PATH} pandoc-${PANDOC_VERSION}/linux/${DISTRIBUTION}/x86_64/pandoc -d ${PANDOC_PREFIX}
        DEPENDS "${MY_DOWNLOAD_PATH}")
    
    execute_process(
        COMMAND unzip -u -j ${MY_DOWNLOAD_PATH} pandoc-${PANDOC_VERSION}/linux/${DISTRIBUTION}/x86_64/pandoc-citeproc -d ${PANDOC_PREFIX}
        DEPENDS "${MY_DOWNLOAD_PATH}")
  endif()
endif()

execute_process(
  COMMAND mkdir -p ${PANDOC_PREFIX}/static
  DEPENDS "${MY_DOWNLOAD_PATH}")

execute_process(
  COMMAND unzip -u -j ${MY_DOWNLOAD_PATH} pandoc-${PANDOC_VERSION}/linux/debian/x86_64/pandoc -d ${PANDOC_PREFIX}/static
  DEPENDS "${MY_DOWNLOAD_PATH}")

execute_process(
    COMMAND unzip -u -j ${MY_DOWNLOAD_PATH} pandoc-${PANDOC_VERSION}/linux/debian/x86_64/pandoc-citeproc -d ${PANDOC_PREFIX}/static
    DEPENDS "${MY_DOWNLOAD_PATH}")
