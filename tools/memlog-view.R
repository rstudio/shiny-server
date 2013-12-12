library(ggplot2)
library(reshape2)
library(shiny)


memlog <- file.choose()
data <- reactiveFileReader(300, NULL, memlog, read.csv)

runApp(list(ui = basicPage(
    plotOutput("plot")
  ),
  server = function(input, output, session) {
    output$plot <- renderPlot({
      p <- ggplot(data = data(), aes(x = 1:nrow(data())))
      p <- p + geom_line(aes(y = rss), color = 'red')
      p <- p + geom_line(aes(y = heapTotal))
      p <- p + geom_line(aes(y = heapUsed))
      p <- p + geom_smooth(aes(y = rss), method = "loess")
      print(p)
    })
  }
), launch.browser = rstudio::viewer)