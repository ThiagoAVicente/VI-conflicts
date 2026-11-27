// View 1: the comparison of two states, side by side, in the place of the details of one state.
// A state is added with Ctrl+click on the map. It shows, for the years of the slider, the numbers and
// the main conflicts of each state, and below one line chart per metric with both states, every year.
// Libraries: d3 v7 (global object d3), loaded in index.html.

// one colour for each state of the comparison; they are not the blue and orange of the two metrics
let STATE_COLORS = [ "#6a4ce2", "#008a17" ];

let CHART_WIDTH = 320,
    CHART_HEIGHT = 120,
    CHART_MARGIN = { top: 8, right: 12, bottom: 20, left: 34 },
    INK = "#1a1a19",
    GRID = "#e6e5e1",
    BAND = "#d8d7d2",
    CONFLICTS = 3;

export const COMPARE_COLORS = STATE_COLORS;

// source: what View 1 knows
//   getEvents()       the events of the checked types, in every year
//   getYears()        [ first, last ] year of the data
//   getShownYears()   [ first, last ] year of the slider
//   getShownMetrics() the metrics ticked in the view (deaths and/or events)
//   getName(code)     the name of a state
//   formatNumber, moveTooltip, hideTooltip, onRemove(code)
export function createStateCompare(root, source) {
    let panel = root.select("#stateCompare");

    let formatAxis = d3.format("~s");

    // one state of the comparison: its events by year
    function getStates(codes) {
        let events = source.getEvents();

        return codes.map((code, i) => ({
            code: code,
            name: source.getName(code),
            color: STATE_COLORS[i],
            events: events.filter(d => d.state === code)
        }));
    }

    function update(codes) {
        panel.property("hidden", codes.length < 2);
        root.select("#panel").classed("isComparing", codes.length >= 2);

        if ( codes.length < 2 ) {
            return;
        }

        let states = getStates(codes),
            [ from, to ] = source.getShownYears(),
            metrics = source.getShownMetrics();

        panel.text("");

        let head = panel.append("div").attr("class", "scHead");

        head.append("h2").text("State comparison");
        head.append("span").text(from === to ? from : from + " to " + to);

        drawColumns(states, metrics, from, to);

        metrics.forEach(metric => drawChart(states, metric, from, to));

        panel.append("p").attr("class", "scHint")
            .text("Ctrl+click another state to change the comparison. Click a state to go back to one.");
    }

    // the two states side by side: name, numbers and main conflicts
    function drawColumns(states, metrics, from, to) {
        let columns = panel.append("div").attr("class", "scColumns")
            .selectAll("div")
            .data(states)
            .join("div")
                .attr("class", "scColumn")
                .style("border-top-color", d => d.color);

        let title = columns.append("h3").attr("class", "scName");

        title.append("span").text(d => d.name).style("color", d => d.color);
        title.append("button")
            .attr("type", "button")
            .attr("aria-label", d => "Take " + d.name + " out of the comparison")
            .text("×")
            .on("click", (e, d) => source.onRemove(d.code));

        columns.each(function(state) {
            let shown = state.events.filter(d => d.year >= from && d.year <= to),
                column = d3.select(this);

            let numbers = column.append("p").attr("class", "scNumbers");

            metrics.forEach(metric => {
                let line = numbers.append("span");

                line.append("strong").text(source.formatNumber(metric.getValue(shown)));
                line.append("span").text(" " + metric.unit);
            });

            let rankBy = metrics[0],
                conflicts = d3.rollups(shown, group => rankBy.getValue(group), d => d.conflict)
                    .sort((a, b) => d3.descending(a[1], b[1]) || d3.ascending(a[0], b[0]))
                    .slice(0, CONFLICTS);

            column.append("h4").text("Main conflicts");

            let list = column.append("ol").attr("class", "scConflicts");

            list.selectAll("li")
                .data(conflicts)
                .join("li")
                    .each(function(d) {
                        d3.select(this).append("span").attr("class", "scConflictName").text(d[0]);
                        d3.select(this).append("span").attr("class", "scConflictValue").text(source.formatNumber(d[1]));
                    });

            if ( conflicts.length === 0 ) {
                column.append("p").attr("class", "scEmpty").text("No events in these years.");
            }
        });
    }

    // the value of the metric in every year, one line for each state, on the same scale
    function drawChart(states, metric, from, to) {
        let [ first, last ] = source.getYears(),
            years = d3.range(first, last + 1);

        let series = states.map(state => {
            let byYear = d3.group(state.events, d => d.year);

            return {
                state: state,
                values: years.map(year => ({ year: year, value: metric.getValue(byYear.get(year) || []) }))
            };
        });

        let block = panel.append("div").attr("class", "scChart");

        block.append("h4").text(metric.name + " per year");

        let svg = block.append("svg")
            .attr("viewBox", [ 0, 0, CHART_WIDTH, CHART_HEIGHT ])
            .attr("role", "img")
            .attr("aria-label", "Line chart of the " + metric.unit + " of " + states.map(d => d.name).join(" and ") + " in each year");

        let x = d3.scaleLinear().domain([ first, last ]).range([ CHART_MARGIN.left, CHART_WIDTH - CHART_MARGIN.right ]),
            base = CHART_HEIGHT - CHART_MARGIN.bottom,
            y = d3.scaleLinear()
                .domain([ 0, d3.max(series, s => d3.max(s.values, d => d.value)) || 1 ])
                .nice(3)
                .range([ base, CHART_MARGIN.top ]);

        // the years of the slider: a band, or a line for one year
        if ( from === to ) {
            svg.append("line")
                .attr("x1", x(from)).attr("x2", x(from))
                .attr("y1", CHART_MARGIN.top).attr("y2", base)
                .attr("stroke", INK).attr("stroke-width", 1.5).attr("opacity", 0.55);
        } else if ( from !== first || to !== last ) {
            svg.append("rect")
                .attr("x", x(from)).attr("y", CHART_MARGIN.top)
                .attr("width", Math.max(2, x(to) - x(from)))
                .attr("height", base - CHART_MARGIN.top)
                .attr("fill", BAND).attr("opacity", 0.5);
        }

        // light grid with the numbers on the left, like the bar charts of the details
        svg.append("g")
            .attr("class", "trendGrid")
            .attr("transform", "translate(" + CHART_MARGIN.left + ",0)")
            .call(d3.axisLeft(y).ticks(3).tickSize(-(CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right)).tickPadding(4).tickFormat(formatAxis));

        svg.append("g")
            .attr("class", "trendAxis")
            .attr("transform", "translate(0," + base + ")")
            .call(d3.axisBottom(x).tickValues(years.filter(year => year % 5 === 0)).tickFormat(d3.format("d")).tickSize(3).tickPadding(4));

        let line = d3.line().x(d => x(d.year)).y(d => y(d.value));

        svg.append("g").selectAll("path")
            .data(series)
            .join("path")
                .attr("d", d => line(d.values))
                .attr("fill", "none")
                .attr("stroke", d => d.state.color)
                .attr("stroke-width", 2)
                .attr("stroke-linejoin", "round");

        // the hovered year: a vertical line, a dot on each line and both values in the tooltip
        let hover = svg.append("g").style("display", "none");

        hover.append("line")
            .attr("y1", CHART_MARGIN.top).attr("y2", base)
            .attr("stroke", INK).attr("stroke-width", 1).attr("opacity", 0.4);
        hover.selectAll("circle")
            .data(series)
            .join("circle")
                .attr("r", 4)
                .attr("fill", d => d.state.color)
                .attr("stroke", "#fcfcfb")
                .attr("stroke-width", 2);

        svg.append("rect")
            .attr("x", CHART_MARGIN.left).attr("y", 0)
            .attr("width", CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right)
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

                source.moveTooltip(e, year + ": " + series.map(s => s.state.name + " " + source.formatNumber(s.values[i].value)).join(", ")
                    + " " + metric.unit);
            })
            .on("mouseout", () => {
                hover.style("display", "none");
                source.hideTooltip();
            });
    }

    return { update };
}
