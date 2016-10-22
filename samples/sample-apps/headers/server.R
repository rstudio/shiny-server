library(shiny)

shinyServer(function(input, output, session) {

  output$summary <- renderText({
    ls(env=session$request)
  })

  output$headers <- renderUI({
    selectInput("header", "Header:", ls(env=session$request))
  })

  output$value <- renderText({
    if (nchar(input$header) < 1 || !exists(input$header, envir=session$request)){
      return("NULL");
    }
    return (get(input$header, envir=session$request));
  })
})
