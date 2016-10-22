shinyUI(pageWithSidebar(
  headerPanel("Shiny Client Data"),
  sidebarPanel(
    uiOutput("headers")
  ),
  mainPanel(
    h3("Headers passed into Shiny"),
    verbatimTextOutput("summary"),
    h3("Value of specified header"),
    verbatimTextOutput("value")
  )
))
