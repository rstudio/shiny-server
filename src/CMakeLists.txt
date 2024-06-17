configure_file("${CMAKE_CURRENT_SOURCE_DIR}/launcher.h.in" "${CMAKE_CURRENT_SOURCE_DIR}/launcher.h")

add_executable(shiny-server launcher.cc)
IF(CMAKE_SYSTEM_NAME MATCHES "FreeBSD")
target_link_libraries(shiny-server procstat)
ENDIF(CMAKE_SYSTEM_NAME MATCHES "FreeBSD")
