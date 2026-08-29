library(shiny)
library(bslib)

ui <- page_sidebar(
  title = "Shiny Server Dev Mode",
  sidebar = sidebar(
    sliderInput("n", "Number of points", min = 10, max = 500, value = 100),
    selectInput("dist", "Distribution", choices = c(
      "Normal" = "norm",
      "Uniform" = "unif",
      "Exponential" = "exp"
    )),
    sliderInput("bins", "Histogram bins", min = 5, max = 50, value = 20)
  ),
  layout_columns(
    card(
      card_header("Histogram"),
      plotOutput("hist")
    ),
    card(
      card_header("Density Estimate"),
      plotOutput("density")
    )
  ),
  card(
    card_header("Summary Statistics"),
    verbatimTextOutput("summary")
  )
)

server <- function(input, output, session) {
  data <- reactive({
    switch(input$dist,
      norm = rnorm(input$n),
      unif = runif(input$n),
      exp  = rexp(input$n)
    )
  })

  output$hist <- renderPlot({
    hist(data(), breaks = input$bins, col = "#2c7bb6", border = "white",
         main = NULL, xlab = "Value")
  })

  output$density <- renderPlot({
    d <- density(data())
    plot(d, main = NULL, xlab = "Value", col = "#d7191c", lwd = 2)
    polygon(d, col = adjustcolor("#d7191c", alpha.f = 0.2), border = NA)
  })

  output$summary <- renderPrint({
    summary(data())
  })
}

shinyApp(ui, server)
