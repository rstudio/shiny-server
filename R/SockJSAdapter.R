#
# SockJSAdapter.R
#
# Copyright (C) 2009-13 by RStudio, Inc.
#
# This program is licensed to you under the terms of version 3 of the
# GNU Affero General Public License. This program is distributed WITHOUT
# ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
# MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
# AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
#

library(shiny)

local({

   # Read config directives from stdin and put them in the environment.
   # This makes it possible for root users to see what app a proc is running
   # (via /proc/<pid>/environ).
   fd = file('stdin')
   input <- readLines(fd)
   Sys.setenv(
    SHINY_APP=input[1],
    SHINY_PORT=input[2],
    SHINY_GAID=input[3])
   close(fd)


   gaTrackingCode <- ''
   if (nzchar(Sys.getenv('SHINY_GAID'))) {
      gaTrackingCode <- HTML(sprintf("<script type=\"text/javascript\">

  var _gaq = _gaq || [];
  _gaq.push(['_setAccount', '%s']);
  _gaq.push(['_trackPageview']);

  (function() {
    var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
    ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js';
    var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);
  })();

</script>", Sys.getenv('SHINY_GAID')))
   }

   inject <- paste(
      tags$script(src='http://cdn.sockjs.org/sockjs-0.3.min.js'),
      tags$script(
        HTML(
          paste(
           'Shiny.createSocket = function() {return new SockJS(location.pathname + "__sockjs__",null,{});};',
           'Shiny.oncustommessage = function(message) {',
           '  if (typeof message === "string") alert(message);', # Legacy format
           '  if (message.alert) alert(message.alert);',
           '  if (message.console && console.log) console.log(message.console);',
           '};',
           sep = '\r\n'
          )
        )
      ),
      gaTrackingCode,
      HTML("</head>"),
      sep="\n"
   )
                            
   filter <- function(ws, header, response) {
      if (response$status < 200 || response$status > 300) return(response)
                                                
      if (!grepl("^text/html\\b", response$content_type, perl=T))
         return(response)

      # HTML files served from static handler are raw. Convert to char so we
      # can inject our head content.
      if (is.raw(response$content))
         response$content <- rawToChar(response$content)

      response$content <- sub("</head>", inject, response$content, 
         ignore.case=T)
      return(response)
   }
                                                        
   options(shiny.http.response.filter=filter)
})
runApp(Sys.getenv('SHINY_APP'),port=Sys.getenv('SHINY_PORT'),launch.browser=FALSE)
