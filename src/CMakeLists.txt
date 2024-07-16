configure_file("${CMAKE_CURRENT_SOURCE_DIR}/launcher.h.in" "${CMAKE_CURRENT_SOURCE_DIR}/launcher.h")
add_executable(shiny-server launcher.cc)