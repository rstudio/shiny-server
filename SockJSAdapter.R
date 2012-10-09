library(shiny)

local({

   inject <- paste(
      tags$script(src='http://cdn.sockjs.org/sockjs-0.3.min.js'),
      tags$script(
            'console.log("starting up shiny app");',
         sprintf(
            'Shiny.createSocket = function() {return new SockJS("%s",null,{debug: true});};',
            Sys.getenv('SHINY_SOCKJSPREFIX')
         ),
         'Shiny.oncustommessage = function(message) {};'
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
