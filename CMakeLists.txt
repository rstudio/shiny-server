cmake_minimum_required(VERSION 2.8)

project(shiny-server)

add_subdirectory(external/node)

install(DIRECTORY bin
                  build
                  config
                  lib
                  manual.test
                  node_modules
                  R
                  src
                  templates
                  test
                  tools
        USE_SOURCE_PERMISSIONS DESTINATION shiny-server)

install(FILES binding.gyp
              config.html
              COPYING
              NEWS
              package.json
              README.md
        DESTINATION shiny-server)

set(CPACK_PACKAGE_NAME "shiny-server")
set(CPACK_PACKAGE_DESCRIPTION "Shiny Server")
set(CPACK_PACKAGE_VENDOR "RStudio, Inc.")
set(CPACK_PACKAGE_CONTACT "RStudio <info@rstudio.com>")
#set(CPACK_PACKAGE_INSTALL_DIRECTORY "RStudio")

include(CPack)
