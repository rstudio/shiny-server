project(pandoc)

set(PANDOC_VERSION 1.19.2.1)

set(PANDOC_DOWNLOADS
    # Format: filename (minus .gz), then colon, then SHA1 hash.
    # Modify the hash values whenever PANDOC_VERSION changes.
    # You can get the new hash values by not updating the values
    # and running the make-package.sh script; the error logs will
    # tell you what the actual hash values were.
    "pandoc:159438262cd1c0d5a6d5d50db53251d209aa5018"
    "pandoc-citeproc:50dd59d4eb1770bb2a17c0e1a0b16cce9f3edfd8")

# PANDOC_PREFIX is the final location that the extracted pandoc
# binaries will be placed: [basedir]/ext/pandoc/
get_filename_component(PANDOC_PREFIX 
    "${CMAKE_CURRENT_SOURCE_DIR}/../../ext/pandoc"
    REALPATH)
file(MAKE_DIRECTORY ${PANDOC_PREFIX})

foreach(DOWNLOAD_INFO ${PANDOC_DOWNLOADS})
    # CMake "lists" are simply semicolon-delimited strings. Convert
    # our colon-delimited strings to a CMake list.
    string(REPLACE ":" ";" DL ${DOWNLOAD_INFO})
    # Extract the first and second elements into CURRENT_FILENAME and
    # CURRENT_SHA CMake variables.
    list(GET DL 0 CURRENT_FILENAME)
    list(GET DL 1 CURRENT_SHA)

    set(DOWNLOAD_DEST "${CMAKE_CURRENT_BINARY_DIR}/${CURRENT_FILENAME}.gz")
    if (EXISTS "${DOWNLOAD_DEST}")
        # If the file was downloaded in the past, check if it's the
        # right file by verifying the SHA1 hash. If it's not the right
        # file then warn and delete it, then continue (it will download).
        file(SHA1 "${DOWNLOAD_DEST}" PANDOC_SHA1_ACTUAL)
        if (NOT "${CURRENT_SHA}" STREQUAL "${PANDOC_SHA1_ACTUAL}")
            message(WARNING "${CURRENT_FILENAME}.gz hash mismatch: expected ${CURRENT_SHA}, actual ${PANDOC_SHA1_ACTUAL}")
            file(REMOVE "${DOWNLOAD_DEST}")
        endif()
    endif()

    if (NOT EXISTS "${DOWNLOAD_DEST}")
        # If the file doesn't exist (or it did exist but had the wrong
        # SHA1 sum, so we deleted it) then download and verify it.
        message(STATUS "Downloading ${CURRENT_FILENAME}")
        file(DOWNLOAD
            "http://s3.amazonaws.com/rstudio-buildtools/pandoc/${PANDOC_VERSION}/linux-64/${CURRENT_FILENAME}.gz"
            "${DOWNLOAD_DEST}"
            SHOW_PROGRESS
            EXPECTED_HASH SHA1=${CURRENT_SHA}
        )
    endif()

    # gunzip the downloaded (or cached) file. If the output file
    # already exists, get rid of it first so gunzip doesn't prompt.
    file(REMOVE "${CMAKE_CURRENT_BINARY_DIR}/${CURRENT_FILENAME}")
    message(STATUS "gunzip ${DOWNLOAD_DEST}")
    execute_process(COMMAND gunzip -k "${DOWNLOAD_DEST}"
        RESULT_VARIABLE UNZIP_RESULT
    )
    if (NOT ${UNZIP_RESULT} EQUAL 0)
        message(FATAL_ERROR "Failed to gunzip ${DOWNLOAD_DEST}")
    endif()

    # Copy and chmod the downloaded file
    file(COPY "${CMAKE_CURRENT_BINARY_DIR}/${CURRENT_FILENAME}"
        DESTINATION "${PANDOC_PREFIX}"
        FILE_PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE WORLD_READ WORLD_EXECUTE
    )

endforeach(DOWNLOAD_INFO)
