library(ggplot2)
library(reshape2)
library(shiny)

memlog <- file.choose()
while (TRUE) {
  data <- read.csv(memlog)
  p <- ggplot(data = data, aes(x = 1:nrow(data)))
  p <- p + geom_line(aes(y = rss), color = 'red')
  p <- p + geom_line(aes(y = heapTotal))
  p <- p + geom_line(aes(y = heapUsed))
  print(p)

  Sys.sleep(5)
}
