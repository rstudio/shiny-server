import numpy as np
from shiny import App, reactive, render, ui

app_ui = ui.page_sidebar(
    ui.sidebar(
        ui.input_slider("n", "Number of points", min=10, max=500, value=100),
        ui.input_select("dist", "Distribution", choices={
            "norm": "Normal",
            "unif": "Uniform",
            "exp": "Exponential",
        }),
        ui.input_slider("bins", "Histogram bins", min=5, max=50, value=20),
    ),
    ui.layout_columns(
        ui.card(
            ui.card_header("Histogram"),
            ui.output_plot("hist"),
        ),
        ui.card(
            ui.card_header("Density Estimate"),
            ui.output_plot("density"),
        ),
    ),
    ui.card(
        ui.card_header("Summary Statistics"),
        ui.output_text_verbatim("summary"),
    ),
    title="Shiny Server Dev Mode (Python)",
)


def server(input, output, session):
    @reactive.calc
    def data():
        rng = np.random.default_rng()
        if input.dist() == "norm":
            return rng.standard_normal(input.n())
        elif input.dist() == "unif":
            return rng.uniform(size=input.n())
        else:
            return rng.exponential(size=input.n())

    @render.plot
    def hist():
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots()
        ax.hist(data(), bins=input.bins(), color="#2c7bb6", edgecolor="white")
        ax.set_xlabel("Value")
        return fig

    @render.plot
    def density():
        from scipy.stats import gaussian_kde
        import matplotlib.pyplot as plt

        d = data()
        kde = gaussian_kde(d)
        x = np.linspace(d.min() - 0.5, d.max() + 0.5, 200)

        fig, ax = plt.subplots()
        ax.plot(x, kde(x), color="#d7191c", linewidth=2)
        ax.fill_between(x, kde(x), alpha=0.2, color="#d7191c")
        ax.set_xlabel("Value")
        return fig

    @render.text
    def summary():
        d = data()
        return (
            f"Min:    {d.min():.4f}\n"
            f"Q1:     {np.percentile(d, 25):.4f}\n"
            f"Median: {np.median(d):.4f}\n"
            f"Mean:   {d.mean():.4f}\n"
            f"Q3:     {np.percentile(d, 75):.4f}\n"
            f"Max:    {d.max():.4f}\n"
            f"Std:    {d.std():.4f}"
        )


app = App(app_ui, server)
