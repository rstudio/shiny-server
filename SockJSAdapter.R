library(shiny)

local({

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
         sprintf(
            'Shiny.createSocket = function() {return new SockJS("%s",null,{debug:true});};',
            Sys.getenv('SHINY_SOCKJSPREFIX')
         ),
         'Shiny.oncustommessage = function(message) {alert(message);};'
      ),
      gaTrackingCode,
      HTML("</head>"),
      sep="\n"
   )
                            
   filter <- function(ws, header, response) {
      if (response$status < 200 || response$status > 300) return(response)
                                                
      if (!grepl("^text/html\\b", response$content_type, perl=T))
         return(response)
                                                    
      response$content <- charToRaw(sub("</head>", inject, rawToChar(response$content), 
         ignore.case=T))
      return(response)
   }
                                                        
   options(shiny.http.response.filter=filter)
})
runApp(Sys.getenv('SHINY_APP'),port=Sys.getenv('SHINY_PORT'),launch.browser=FALSE)
