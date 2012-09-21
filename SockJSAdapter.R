library(RJSONIO)
library(websockets)
library(shiny)

local({

   initSockJS <- sprintf(
      'Shiny.createSocket = function() {return new SockJS("%s");};',
      Sys.getenv('SHINY_SOCKJSPREFIX')
   )

   inject <- paste(
      tags$script(src='http://cdn.sockjs.org/sockjs-0.3.min.js'),
      tags$script(
         sprintf(
            'Shiny.createSocket = function() {return new SockJS("%s");};',
            Sys.getenv('SHINY_SOCKJSPREFIX')
         )
      ),
      HTML("</head>"),
      sep="\n"
   )
                            
   filter <- function(ws, header, response) {
      if (response$status < 200 || response$status > 300) return(response)
                                                
      if (!grepl("^text/html\\b", response$content_type, perl=T))
         return(response)
                                                    
      response$content <- sub("</head>", inject, response$content, 
         ignore.case=T)
      return(response)
   }
                                                        
   options(shiny.http.response.filter=filter)
})
runApp(Sys.getenv('SHINY_APP'),port=Sys.getenv('SHINY_PORT'),launch.browser=FALSE)
