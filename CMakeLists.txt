cmake_minimum_required(VERSION 2.8.10)

project(shiny-server)

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/bin")

if ("$ENV{BUILD_NUMBER}" STREQUAL "")
  set(BUILD_NUMBER "0")
else()
  set(BUILD_NUMBER $ENV{BUILD_NUMBER})
endif()

# Extract the shiny-server version number from package.json
execute_process(COMMAND sed -n "s/\\s*\"version\": \"\\(.*\\)\",\\s*/\\1/p"
                INPUT_FILE "${CMAKE_CURRENT_SOURCE_DIR}/package.json"
                OUTPUT_VARIABLE NPM_PACKAGE_VERSION
                OUTPUT_STRIP_TRAILING_WHITESPACE)
# Parse major, minor, and patch values from NPM_PACKAGE_VERSION
STRING(REGEX REPLACE "([0-9]+)\\.([0-9]+)\\.([0-9]+)"
       "\\1" CPACK_PACKAGE_VERSION_MAJOR ${NPM_PACKAGE_VERSION})
STRING(REGEX REPLACE "([0-9]+)\\.([0-9]+)\\.([0-9]+)"
       "\\2" CPACK_PACKAGE_VERSION_MINOR ${NPM_PACKAGE_VERSION})
STRING(REGEX REPLACE "([0-9]+)\\.([0-9]+)\\.([0-9]+)"
       "\\3" CPACK_PACKAGE_VERSION_PATCH ${NPM_PACKAGE_VERSION})

set(CPACK_PACKAGE_VERSION "${CPACK_PACKAGE_VERSION_MAJOR}.${CPACK_PACKAGE_VERSION_MINOR}.${CPACK_PACKAGE_VERSION_PATCH}.${BUILD_NUMBER}")

execute_process(COMMAND git describe --tags --dirty
                WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                OUTPUT_FILE "${CMAKE_CURRENT_BINARY_DIR}/GIT_VERSION")
execute_process(COMMAND echo "${CPACK_PACKAGE_VERSION}"
                WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                OUTPUT_FILE "${CMAKE_CURRENT_BINARY_DIR}/VERSION")

add_subdirectory(src)
add_subdirectory(external/node)
add_subdirectory(external/pandoc)

install(DIRECTORY assets
                  samples                  
                  build
                  config
                  ext
                  lib
                  manual.test
                  node_modules
                  R
                  templates
                  test
                  tools
        USE_SOURCE_PERMISSIONS DESTINATION shiny-server)


# Configure and assemble /bin directory.
configure_file(bin/deploy-example.in bin/deploy-example)
install(PROGRAMS bin/node
                 bin/npm
                 bin/shiny-server
                 "${CMAKE_CURRENT_BINARY_DIR}/bin/deploy-example"
        DESTINATION shiny-server/bin)

# Render and rename NOTICE.md
execute_process(COMMAND cat 
                INPUT_FILE ${CMAKE_CURRENT_SOURCE_DIR}/NOTICE.md
                OUTPUT_FILE ${CMAKE_CURRENT_BINARY_DIR}/NOTICE)

install(FILES binding.gyp
              config.html
              COPYING
              NEWS
              package.json
              README.md
              "${CMAKE_CURRENT_BINARY_DIR}/NOTICE"
              "${CMAKE_CURRENT_BINARY_DIR}/VERSION"
              "${CMAKE_CURRENT_BINARY_DIR}/GIT_VERSION"
        DESTINATION shiny-server)


set(CPACK_PACKAGE_NAME "shiny-server")
set(CPACK_PACKAGE_DESCRIPTION "Shiny Server")
set(CPACK_PACKAGE_VENDOR "RStudio, Inc.")
set(CPACK_PACKAGE_CONTACT "RStudio <info@rstudio.com>")
#set(CPACK_PACKAGE_INSTALL_DIRECTORY "Shiny Server")

# == Linux packaging directives ==

# configure cpack install location
set(CPACK_SET_DESTDIR "ON")
set(CPACK_INSTALL_PREFIX "${CMAKE_INSTALL_PREFIX}")

# detect architecture (packaging platform specific)
find_program(DPKG_EXECUTABLE dpkg)
find_program(RPM_EXECUTABLE rpm)
if (NOT PACKAGE_ARCHITECTURE)
   if(DPKG_EXECUTABLE)
      exec_program(dpkg ARGS --print-architecture
                   OUTPUT_VARIABLE PACKAGE_ARCHITECTURE)
      set(PACKAGE_DIST "")
   elseif(RPM_EXECUTABLE)
      #RHEL/CentOS
      exec_program(arch OUTPUT_VARIABLE PACKAGE_ARCHITECTURE) 
      execute_process(COMMAND sed -nr "s/.*\\ ([0-9]+)\\.[0-9]+(\\.[0-9]+)?\\ .*/\\1/p"
                INPUT_FILE "/etc/redhat-release"
                OUTPUT_VARIABLE RH_VER
                OUTPUT_STRIP_TRAILING_WHITESPACE)
      set(PACKAGE_DIST "-rh${RH_VER}")
   endif()
endif()

# debian control files
set(DEBIAN_POSTINST postinst.in)
set(DEBIAN_PRERM prerm.in)
set(DEBIAN_POSTRM postrm.in)

# rpm scripts
set(RPM_POSTINST postinst.sh.in)
set(RPM_POSTRM postrm.sh.in)
set(CPACK_RPM_PACKAGE_AUTOREQPROV " no")


# debian dependencies -- to install the .deb from the command line with
# automatic dependency resolution use e.g.
#   sudo apt-get install gdebi-core
#   sudo gdebi shiny-server-<version>-amd64.deb

# define package suffix
set(SHINY_SERVER_PACKAGE_SUFFIX "-")

# include overlay if it exists
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/CMakeOverlay.txt")
   include(CMakeOverlay.txt)
endif()

# dynamically configured debian control scripts
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/packaging/debian-control/${DEBIAN_POSTINST}
               ${CMAKE_CURRENT_BINARY_DIR}/packaging/debian-control/postinst)
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/packaging/debian-control/${DEBIAN_PRERM}
               ${CMAKE_CURRENT_BINARY_DIR}/packaging/debian-control/prerm)
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/packaging/debian-control/${DEBIAN_POSTRM}
               ${CMAKE_CURRENT_BINARY_DIR}/packaging/debian-control/postrm)

set(CPACK_DEBIAN_PACKAGE_CONTROL_EXTRA "${CMAKE_CURRENT_BINARY_DIR}/packaging/debian-control/postinst;${CMAKE_CURRENT_BINARY_DIR}/packaging/debian-control/prerm;${CMAKE_CURRENT_BINARY_DIR}/packaging/debian-control/postrm")

# dynamically configured rpm scripts (only works with cmake 2.8.1 or higher). 
# alternatively you can get CPackRPM.cmake from the cmake tip and copy it into
# your local cmake modules directory -- this is what we currently do
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/packaging/rpm-script/${RPM_POSTINST}
               ${CMAKE_CURRENT_BINARY_DIR}/packaging/rpm-script/postinst.sh)
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/packaging/rpm-script/${RPM_POSTRM}
               ${CMAKE_CURRENT_BINARY_DIR}/packaging/rpm-script/postrm.sh)

# Magic to prevent static pandoc binaries from breaking
set(CPACK_RPM_SPEC_INSTALL_POST "/bin/true")

set(CPACK_RPM_POST_INSTALL_SCRIPT_FILE "${CMAKE_CURRENT_BINARY_DIR}/packaging/rpm-script/postinst.sh")
set(CPACK_RPM_POST_UNINSTALL_SCRIPT_FILE "${CMAKE_CURRENT_BINARY_DIR}/packaging/rpm-script/postrm.sh")

# package file name
set(CPACK_PACKAGE_FILE_NAME "${CPACK_PACKAGE_NAME}${SHINY_SERVER_PACKAGE_SUFFIX}${CPACK_PACKAGE_VERSION}${PACKAGE_DIST}-${PACKAGE_ARCHITECTURE}")
string(TOLOWER "${CPACK_PACKAGE_FILE_NAME}" CPACK_PACKAGE_FILE_NAME)

# variables to be re-used in package description fields
set(PACKAGE_LONG_DESCRIPTION "Shiny Server is a server program from RStudio, Inc. that makes Shiny applications available over the web. Shiny is a web application framework for the R statistical computation language.")

# debian-specific
set(CPACK_DEBIAN_PACKAGE_DESCRIPTION "${CPACK_PACKAGE_DESCRIPTION}\n ${PACKAGE_LONG_DESCRIPTION}")
set(CPACK_DEBIAN_PACKAGE_ARCHITECTURE "${PACKAGE_ARCHITECTURE}")
set(CPACK_DEBIAN_PACKAGE_DEPENDS "libssl0.9.8, libc6 (>= 2.7)")
set(CPACK_DEBIAN_PACKAGE_RECOMMENDS "r-base (>= 2.15.1)")

# rpm-specific
set(CPACK_RPM_PACKAGE_SUMMARY "${CPACK_PACKAGE_NAME}")
set(CPACK_RPM_PACKAGE_DESCRIPTION "${PACKAGE_LONG_DESCRIPTION}")
set(CPACK_RPM_PACKAGE_LICENSE "AGPL v.3.0")
set(CPACK_RPM_PACKAGE_GROUP "System Environment/Daemons")
set(CPACK_RPM_PACKAGE_ARCHITECTURE "${PACKAGE_ARCHITECTURE}")
set(CPACK_RPM_PACKAGE_REQUIRES "openssl libffi")


include(CPack)
