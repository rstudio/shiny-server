library(shiny)

# Define UI for application that plots random distributions 
shinyUI(pageWithSidebar(
  
  # Application title
  headerPanel("It's Alive!"),
  
  # Sidebar with a slider input for number of observations
  sidebarPanel(
    sliderInput("bins",
                  "Number of bins:",
                  min = 1,
                  max = 50,
                  value = 30)
  ),
  
  # Show a plot of the generated distribution
  mainPanel(
    plotOutput("distPlot", height=250)
  )
))
