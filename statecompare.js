// View 1: the comparison of the selected states (a click on the map adds a state), under the slider.
// One line chart for each metric shown: a line for each selected state, on the same scale, over the years
// of the slider (from its first to its last year; with one year, a dot for each state).
// Libraries: d3 v7 (global object d3), loaded in index.html.

// colours of the compared states, in the order they are picked. The blue and the orange (the hues of the
// two metrics) come last, so the first states do not look like a metric
export const STATE_COLORS = [ "#6a4ce2", "#008a17", "#f2a600", "#ee7fac", "#00b894", "#ec4647", "#257de0", "#f47230" ];

export const MAX_STATES = STATE_COLORS.length;

// the dashed line: all the selected states together
let TOTAL = { name: "Total", color: "#1a1a19", dashed: true };

let CHART_HEIGHT = 220,
    CHART_MARGIN = { top: 14, right: 16, bottom: 24, left: 42 },
    INK = "#1a1a19";

// source: what View 1 knows
//   getEvents()       the events of the checked types, in every year
//   getYears()        [ first, last ] year of the data
//   getTimeline()     [ first, last ] year of the slider (in compare mode, the years in between too)
//   getShownMetrics() the metrics ticked in the view (deaths and/or events)
//   getName(code), getColor(code), formatNumber, moveTooltip, hideTooltip, onRemove(code)
export function createStateCompare(root, source) {
    let section = root.select(".stateCompare"),
        legend = section.select(".stateLegend"),
        charts = section.select(".stateCharts");

    let formatAxis = d3.format("~s"),
        cumulative = true,
        lastCodes = [],
        lastWidth = 0;

    // the charts take the width of the page: they are drawn again when it changes
    new ResizeObserver(() => {
        let width = charts.node().clientWidth;

        if ( width !== lastWidth && !section.property("hidden") ) {
            update(lastCodes);
        }
    }).observe(charts.node());

    section.selectAll(".sumSwitch input").on("change", function() {
        cumulative = this.value === "added";
        update(lastCodes);
    });

    function update(codes) {
        lastCodes = codes;
        section.property("hidden", codes.length < 2);

        if ( codes.length < 2 ) {
            return;
        }

        let byState = d3.group(source.getEvents(), d => d.state);

        let states = codes.map(code => ({
            code: code,
            name: source.getName(code),
            color: source.getColor(code),
            events: byState.get(code) || []
        }));

        drawLegend(states);
        section.select(".stateCompareNote").text(cumulative ? "Added up from " + source.getTimeline()[0] + "." : "Year by year.");

        // the charts are drawn again: the height stays while they are, so the page does not shrink and
        // jump back up (measuring the width in between makes the browser lay the page out)
        charts.style("min-height", charts.node().offsetHeight + "px");
        charts.text("");
        source.getShownMetrics().forEach(metric => drawChart(states, metric));
        charts.style("min-height", null);
    }

    // the names with the colour of their line; the x takes a state out of the comparison
    function drawLegend(states) {
        let items = legend.text("").selectAll("span")
            .data(states.concat(TOTAL))
            .join("span")
                .attr("class", "stateKey");

        items.append("i").style("background", d => d.dashed ? "repeating-linear-gradient(90deg, " + INK + " 0 5px, transparent 5px 8px)" : d.color);
        items.append("span").text(d => d.name);

        // the total is not a state: nothing to take out
        items.filter(d => !d.dashed).append("button")
            .attr("type", "button")
            .attr("aria-label", d => "Take " + d.name + " out of the comparison")
            .text("×")
            .on("click", (e, d) => source.onRemove(d.code));
    }

    function drawChart(states, metric) {
        let [ first, last ] = source.getTimeline(),
            years = d3.range(first, last + 1);

        let picked = states.map(state => {
            let byYear = d3.group(state.events, d => d.year);

            let sum = 0;

            return {
                state: state,
                values: years.map(year => {
                    sum += metric.getValue(byYear.get(year) || []);
                    return { year: year, value: cumulative ? sum : metric.getValue(byYear.get(year) || []) };
                })
            };
        });

        // the states are different places: the total is the sum of their lines
        let series = picked.concat({
            state: TOTAL,
            values: years.map((year, i) => ({ year: year, value: d3.sum(picked, s => s.values[i].value) }))
        });

        let block = charts.append("div").attr("class", "stateChart");

        // pixels, so the text of every chart has the same size
        let width = Math.max(300, Math.floor(block.node().clientWidth));
        lastWidth = charts.node().clientWidth;

        block.append("h3").text(metric.name);

        let svg = block.append("svg")
            .attr("width", width)
            .attr("height", CHART_HEIGHT)
            .attr("role", "img")
            .attr("aria-label", "Line chart of the " + metric.unit + " of " + states.map(d => d.name).join(", ") + " in each year");

        let left = CHART_MARGIN.left,
            right = width - CHART_MARGIN.right,
            top = CHART_MARGIN.top,
            base = CHART_HEIGHT - CHART_MARGIN.bottom;

        // one year has no width: it goes in the middle
        let x = d3.scaleLinear().domain(first === last ? [ first - 1, last + 1 ] : [ first, last ]).range([ left, right ]),
            y = d3.scaleLinear()
                .domain([ 0, d3.max(series, s => d3.max(s.values, d => d.value)) || 1 ])
                .nice(4)
                .range([ base, top ]);

        // light grid with the numbers on the left, like the bar charts of the details
        svg.append("g")
            .attr("class", "trendGrid")
            .attr("transform", "translate(" + left + ",0)")
            .call(d3.axisLeft(y).ticks(4).tickSize(-(right - left)).tickPadding(6).tickFormat(formatAxis));

        svg.append("g")
            .attr("class", "trendAxis")
            .attr("transform", "translate(0," + base + ")")
            .call(d3.axisBottom(x).tickValues(getTicks(years, right - left)).tickFormat(d3.format("d")).tickSize(3).tickPadding(5));

        let line = d3.line().x(d => x(d.year)).y(d => y(d.value));

        svg.append("g").selectAll("path")
            .data(series)
            .join("path")
                .attr("d", d => line(d.values))
                .attr("fill", "none")
                .attr("stroke", d => d.state.color)
                .attr("stroke-dasharray", d => d.state.dashed ? "6 4" : null)
                .attr("stroke-width", 2)
                .attr("stroke-linejoin", "round");

        // one year draws no line: a dot for each state
        if ( years.length === 1 ) {
            svg.append("g").selectAll("circle")
                .data(series)
                .join("circle")
                    .attr("cx", x(first))
                    .attr("cy", d => y(d.values[0].value))
                    .attr("r", 4)
                    .attr("fill", d => d.state.color);
        }

        // the hovered year: a vertical line, a dot on each line and every value in the tooltip
        let hover = svg.append("g").style("display", "none");

        hover.append("line")
            .attr("y1", top).attr("y2", base)
            .attr("stroke", INK).attr("stroke-width", 1).attr("opacity", 0.4);
        hover.selectAll("circle")
            .data(series)
            .join("circle")
                .attr("r", 4)
                .attr("fill", d => d.state.color)
                .attr("stroke", "#fcfcfb")
                .attr("stroke-width", 2);

        svg.append("rect")
            .attr("x", left).attr("y", 0)
            .attr("width", right - left)
            .attr("height", base)
            .attr("fill", "none")
            .attr("pointer-events", "all")
            .on("mousemove", e => {
                let [ px ] = d3.pointer(e),
                    year = Math.max(first, Math.min(last, Math.round(x.invert(px)))),
                    i = year - first;

                hover.style("display", null);
                hover.select("line").attr("x1", x(year)).attr("x2", x(year));
                hover.selectAll("circle")
                    .attr("cx", x(year))
                    .attr("cy", d => y(d.values[i].value));

                // the biggest value first
                let text = series.slice()
                    .sort((a, b) => d3.descending(a.values[i].value, b.values[i].value))
                    .map(s => s.state.name + " " + source.formatNumber(s.values[i].value))
                    .join(", ");

                source.moveTooltip(e, year + ": " + text + " " + metric.unit);
            })
            .on("mouseout", () => {
                hover.style("display", "none");
                source.hideTooltip();
            });
    }

    // every year when there is room (about 36px each), otherwise every 2nd, 5th or 10th year
    function getTicks(years, width) {
        let every = [ 1, 2, 5, 10 ].find(n => width / years.length * n >= 36) || 10;

        return years.filter(year => year % every === 0 || years.length === 1);
    }

    return { update };
}
