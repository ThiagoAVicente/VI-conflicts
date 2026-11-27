// View 1: a heatmap of the states (rows) and the years (columns) of the selection, under the slider: the
// years from the first to the last year of the slider, and the selected states (every state when none is
// selected). The map adds the period up; the heatmap keeps each year apart, so it answers when each
// state took part in the violence, and how it spread from state to state.
// Libraries: d3 v7 (global object d3), loaded in index.html.

// the five regions of Brazil (IBGE), from north to south
let REGIONS = [
    { name: "North", states: [ "AC", "AM", "AP", "PA", "RO", "RR", "TO" ] },
    { name: "Northeast", states: [ "AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE" ] },
    { name: "Centre-West", states: [ "DF", "GO", "MS", "MT" ] },
    { name: "Southeast", states: [ "ES", "MG", "RJ", "SP" ] },
    { name: "South", states: [ "PR", "RS", "SC" ] }
];

// the rows are taller when there are few states, so a few states do not sit in a thin band
let ROW_HEIGHTS = [ { states: 5, height: 30 }, { states: 10, height: 22 }, { states: Infinity, height: 16 } ],
    // in the order by region, each region starts with its name, in this gap
    REGION_GAP = 20,
    MARGIN = { top: 22, right: 76, bottom: 4, left: 150 },
    // the columns share the width of the page, up to this width (one or two years stay a column, not a band)
    MAX_STEP = 120,
    // a cell this big has room for its number: with few years and states the heatmap is also a table
    NUMBER_WIDTH = 34,
    NUMBER_HEIGHT = 16,
    // with the numbers the bars of the totals are shorter, their number goes after them
    NUMBER_BAR = 26,
    // the years on top need this much room each to be written all
    LABEL_STEP = 32,
    // the bars of the totals, on the right of the cells
    TOTAL_GAP = 10,
    LEGEND_WIDTH = 160,
    MOVE_TIME = 600,
    EMPTY = "#e6e5e1",
    INK = "#1a1a19",
    MUTED = "#77776f";

// source: what View 1 knows
//   getEvents()          the events of the checked types, in every year
//   getYears()           [ first, last ] year of the data
//   getTimeline()        [ first, last ] year of the slider (in compare mode, the years in between too)
//   isSelectedYear(year) the years of the slider (the period, the year, or the two compared years)
//   getSelected()        the codes of the selected states
//   metrics              deaths and events, with their colours (METRICS of view1.js)
//   getName(code), getColor(code), formatNumber, moveTooltip, hideTooltip, reducedMotion
//   onPickState(code, add), onPickYear(year)
export function createHeatmap(root, source) {
    let section = root.select(".heatmap"),
        frame = section.select(".heatmapFrame"),
        legend = section.select(".heatmapLegend"),
        subtitle = section.select(".heatmapSub");

    let metricKey = "deaths",
        order = "region",
        lastOrder = order,
        lastWidth = 0,
        rowHeight = 16;

    let svg = frame.append("svg")
        .attr("role", "img")
        .attr("aria-label", "Heatmap of the states of Brazil by year");

    let regionLayer = svg.append("g"),
        rowLayer = svg.append("g"),
        yearLayer = svg.append("g"),
        spanLayer = svg.append("g").attr("class", "hmSpans");

    let totalTitle = svg.append("text")
        .attr("class", "hmHeader")
        .attr("y", MARGIN.top - 8)
        .text("Total");

    // the chart takes the width of the page: it is drawn again when it changes (and when the view
    // comes back on screen, it has no width while it is hidden)
    new ResizeObserver(() => {
        let width = frame.node().clientWidth;

        if ( width !== lastWidth ) {
            update();
        }
    }).observe(frame.node());

    section.selectAll("input[name='hmMetric']").on("change", function() {
        metricKey = this.value;
        update();
    });

    section.selectAll("input[name='hmOrder']").on("change", function() {
        order = this.value;
        update();
    });

    // one row per state shown, with its value in every year, the total and the first year with an event
    function getRows(metric, years, codes) {
        let [ from, to ] = [ years[0], years[years.length - 1] ];

        let byCell = d3.group(source.getEvents().filter(d => d.year >= from && d.year <= to), d => d.state, d => d.year);

        let rows = REGIONS.flatMap((region, regionIndex) => region.states.filter(code => codes.includes(code)).map(code => {
            let byYear = byCell.get(code) || new Map();

            let cells = years.map(year => {
                let group = byYear.get(year) || [];

                return { code: code, year: year, group: group, value: metric.getValue(group) };
            });

            return {
                code: code,
                name: source.getName(code),
                region: region.name,
                regionIndex: regionIndex,
                cells: cells,
                total: d3.sum(cells, d => d.value),
                first: byYear.size > 0 ? d3.min(byYear.keys()) : Infinity
            };
        }));

        let byTotal = (a, b) => b.total - a.total || a.name.localeCompare(b.name);

        if ( order === "region" ) {
            rows.sort((a, b) => a.regionIndex - b.regionIndex || byTotal(a, b));
        } else if ( order === "first" ) {
            rows.sort((a, b) => a.first - b.first || byTotal(a, b));
        } else {
            rows.sort(byTotal);
        }
        return rows;
    }

    // the y of every row; in the order by region there is a gap with the name before each region
    function placeRows(rows) {
        let y = MARGIN.top,
            regionLabels = [];

        rows.forEach((row, i) => {
            if ( order === "region" && (i === 0 || row.region !== rows[i - 1].region) ) {
                y += i === 0 ? REGION_GAP - 6 : REGION_GAP;
                regionLabels.push({ name: row.region, y: y - 5 });
            }
            row.y = y;
            y += rowHeight;
        });
        return { height: y + MARGIN.bottom, regionLabels: regionLabels };
    }

    function update() {
        let width = frame.node().clientWidth;

        lastWidth = width;
        if ( width === 0 ) {
            return;
        }

        let metric = source.metrics.find(d => d.key === metricKey),
            [ from, to ] = source.getTimeline(),
            years = d3.range(from, to + 1),
            selected = source.getSelected(),
            codes = selected.length > 0 ? selected : REGIONS.flatMap(d => d.states),
            rows = getRows(metric, years, codes);

        rowHeight = ROW_HEIGHTS.find(d => rows.length <= d.states).height;

        let { height, regionLabels } = placeRows(rows);

        let step = Math.min(MAX_STEP, (width - MARGIN.left - MARGIN.right) / years.length);

        let x = d3.scaleBand()
            .domain(years)
            .range([ MARGIN.left, MARGIN.left + step * years.length ])
            .paddingInner(0.08);

        // the same classes in every year, state and selection (the biggest state-year of the data), so
        // the colours do not change while the slider moves: log, so the small states and years still show
        let max = d3.max(d3.rollup(source.getEvents(), metric.getValue, d => d.state, d => d.year).values(),
            byYear => d3.max(byYear.values())) || 1;

        let color = d3.scaleSequentialLog(d3.interpolateRgbBasis(metric.colors.slice(1)))
            .domain([ 1, Math.max(2, max) ]);

        let fill = value => value > 0 ? color(Math.max(1, value)) : EMPTY;

        let numbers = x.bandwidth() >= NUMBER_WIDTH && rowHeight >= NUMBER_HEIGHT;

        let total = d3.scaleLinear()
            .domain([ 0, d3.max(rows, d => d.total) || 1 ])
            .range([ 0, numbers ? NUMBER_BAR : MARGIN.right - TOTAL_GAP - 4 ]);

        let moving = order !== lastOrder && !source.reducedMotion;

        lastOrder = order;
        svg.attr("width", width).attr("height", height);

        subtitle.text((from === to ? from : from + "-" + to) + ", "
            + (selected.length === 0 ? "every state" : selected.length === 1 ? rows[0].name : selected.length + " selected states")
            + ". When each state took part in the violence, and how it spread.");

        frame.classed("tall", rowHeight >= 30);
        drawRows(rows, x, fill, total, selected, moving, numbers);
        drawRegions(regionLabels);
        drawYears(years, x, height);
        drawLegend(metric, color, max);

        totalTitle.attr("x", x.range()[1] + TOTAL_GAP);
    }

    function drawRows(rows, x, fill, total, selected, moving, numbers) {
        // "2,666", or "2.7k" when the column is narrow
        let formatCell = value => value >= 1000 && x.bandwidth() < 44 ? d3.format(".2~s")(value) : source.formatNumber(value);

        let groups = rowLayer.selectAll("g.hmRow")
            .data(rows, d => d.code)
            .join(enter => {
                let g = enter.append("g")
                    .attr("class", "hmRow")
                    .attr("transform", d => "translate(0," + d.y + ")");

                g.append("rect").attr("class", "hmMark");
                g.append("text")
                    .attr("class", "hmName")
                    .attr("dy", "0.32em")
                    .on("click", (e, d) => source.onPickState(d.code, e.ctrlKey || e.metaKey));
                g.append("rect").attr("class", "hmTotal");
                g.append("text").attr("class", "hmTotalText").attr("dy", "0.32em");
                g.append("g").attr("class", "hmCells");
                g.append("g").attr("class", "hmNumbers");
                return g;
            });

        // a new order moves the rows; any other change (e.g. while playing) places them at once
        (moving ? groups.transition().duration(MOVE_TIME) : groups.interrupt())
            .attr("transform", d => "translate(0," + d.y + ")");

        // the selected states: bold, with the colour of their line in the comparison chart
        groups.classed("selected", d => selected.includes(d.code));

        groups.select(".hmMark")
            .attr("x", MARGIN.left - 6)
            .attr("y", 1)
            .attr("width", 3)
            .attr("height", rowHeight - 2)
            .attr("fill", d => selected.includes(d.code) ? source.getColor(d.code) : "none");

        groups.select(".hmName")
            .attr("x", MARGIN.left - 12)
            .attr("y", rowHeight / 2)
            .text(d => d.name);

        groups.select(".hmTotal")
            .attr("x", x.range()[1] + TOTAL_GAP)
            .attr("y", 3)
            .attr("height", rowHeight - 6)
            .attr("width", d => total(d.total))
            .attr("fill", d => d.total > 0 ? fill(d3.max(d.cells, c => c.value)) : EMPTY);

        groups.select(".hmTotalText")
            .attr("x", d => x.range()[1] + TOTAL_GAP + total(d.total) + 4)
            .attr("y", rowHeight / 2)
            .text(d => numbers ? source.formatNumber(d.total) : "");

        groups.select(".hmCells").selectAll("rect")
            .data(d => d.cells, d => d.year)
            .join(enter => enter.append("rect")
                .on("mouseover", showCell)
                .on("mousemove", showCell)
                .on("mouseout", hideCell)
                .on("click", (e, d) => source.onPickState(d.code, e.ctrlKey || e.metaKey)))
                .attr("x", d => x(d.year))
                .attr("y", 1)
                .attr("width", x.bandwidth())
                .attr("height", rowHeight - 2)
                .attr("fill", d => fill(d.value));

        // the number of each cell, in its middle (none for 0: the grey says it), light on the dark cells
        groups.select(".hmNumbers").selectAll("text")
            .data(d => numbers ? d.cells.filter(c => c.value > 0) : [], d => d.year)
            .join("text")
                .attr("x", d => x(d.year) + x.bandwidth() / 2)
                .attr("y", rowHeight / 2)
                .attr("dy", "0.32em")
                .attr("fill", d => d3.lab(fill(d.value)).l < 52 ? "#fcfcfb" : INK)
                .text(d => formatCell(d.value));
    }

    function drawRegions(labels) {
        regionLayer.selectAll("text")
            .data(labels, d => d.name)
            .join("text")
                .attr("class", "hmRegion")
                .attr("x", 0)
                .attr("y", d => d.y)
                .text(d => d.name);
    }

    // the years on top: all of them when there is room, otherwise every fifth year, the first and the
    // last (the ones next to the first and the last are left out, so they do not overlap). In compare
    // mode a dark frame goes around the two compared years, and their labels are bold.
    // A click on a year shows only that year
    function drawYears(years, x, height) {
        let first = years[0],
            last = years[years.length - 1];

        let spans = [];

        years.filter(source.isSelectedYear).forEach(year => {
            let last = spans[spans.length - 1];

            if ( last && last.end === year - 1 ) {
                last.end = year;
            } else {
                spans.push({ start: year, end: year });
            }
        });

        // every year is selected (one year, or a range): nothing to frame
        if ( spans.length === 1 ) {
            spans = [];
        }

        let strong = new Set(spans.flatMap(d => [ d.start, d.end ]));

        let ends = new Set([ first, last, ...strong ]);

        let labels = x.step() >= LABEL_STEP ? years : years.filter(year => ends.has(year)
            || (year % 5 === 0 && !years.some(other => ends.has(other) && Math.abs(other - year) <= 2)));

        yearLayer.selectAll("text")
            .data(labels, d => d)
            .join("text")
                .attr("class", "hmYear")
                .classed("selected", d => strong.has(d))
                .attr("x", d => x(d) + x.bandwidth() / 2)
                .attr("y", MARGIN.top - 8)
                .text(d => d);

        yearLayer.selectAll("rect")
            .data(years)
            .join("rect")
                .attr("class", "hmYearHit")
                .attr("x", d => x(d))
                .attr("y", 0)
                .attr("width", x.step())
                .attr("height", MARGIN.top)
                .on("click", (e, d) => source.onPickYear(d))
                .on("mousemove", (e, d) => source.moveTooltip(e, "Click to see only " + d))
                .on("mouseout", source.hideTooltip);

        spanLayer.selectAll("rect")
            .data(spans)
            .join("rect")
                .attr("x", d => x(d.start) - 1.5)
                .attr("y", MARGIN.top - 2)
                .attr("width", d => x(d.end) + x.bandwidth() - x(d.start) + 3)
                .attr("height", height - MARGIN.top - MARGIN.bottom + 2);
    }

    // a grey square for none, then the log scale of the metric, with ticks at the powers of ten
    function drawLegend(metric, color, max) {
        let scale = d3.scaleLog().domain(color.domain()).range([ 0, LEGEND_WIDTH ]),
            // the powers of ten that do not run into the label of the maximum
            ticks = [ 1, 10, 100, 1000, 10000 ].filter(d => scale(Math.max(2, max)) - scale(d) > 30).concat(max),
            gradientId = "hmGradient";

        let legendSvg = legend.selectAll("svg")
            .data([ null ])
            .join("svg")
                .attr("width", LEGEND_WIDTH + 70)
                .attr("height", 34);

        legendSvg.selectAll("defs")
            .data([ null ])
            .join("defs")
            .selectAll("linearGradient")
            .data([ null ])
            .join("linearGradient")
                .attr("id", gradientId)
            .selectAll("stop")
            .data(d3.range(0, 1.01, 0.1))
            .join("stop")
                .attr("offset", d => d)
                .attr("stop-color", d => color(scale.invert(d * LEGEND_WIDTH)));

        legendSvg.selectAll(".hmNone")
            .data([ null ])
            .join("rect")
                .attr("class", "hmNone")
                .attr("x", 0)
                .attr("y", 2)
                .attr("width", 12)
                .attr("height", 12)
                .attr("fill", EMPTY);

        legendSvg.selectAll(".hmNoneText")
            .data([ null ])
            .join("text")
                .attr("class", "hmNoneText hmLegendText")
                .attr("x", 6)
                .attr("y", 28)
                .text("0");

        let bar = legendSvg.selectAll(".hmBar")
            .data([ null ])
            .join("g")
                .attr("class", "hmBar")
                .attr("transform", "translate(24,0)");

        bar.selectAll("rect")
            .data([ null ])
            .join("rect")
                .attr("y", 2)
                .attr("width", LEGEND_WIDTH)
                .attr("height", 12)
                .attr("fill", "url(#" + gradientId + ")");

        bar.selectAll("text")
            .data(ticks)
            .join("text")
                .attr("class", "hmLegendText")
                .attr("x", d => scale(Math.max(1, d)))
                .attr("y", 28)
                .text(d => source.formatNumber(d));

        legend.selectAll("span")
            .data([ null ])
            .join("span")
                .text(metric.unit + " a year");
    }

    function describe(group) {
        return source.metrics.map(metric => {
            let value = metric.getValue(group);

            return source.formatNumber(value) + " " + (value === 1 ? metric.singular : metric.unit);
        }).join(", ");
    }

    function showCell(e, d) {
        d3.select(this).classed("hovered", true);
        source.moveTooltip(e, source.getName(d.code) + ", " + d.year + ": " + describe(d.group));
    }

    function hideCell() {
        d3.select(this).classed("hovered", false);
        source.hideTooltip();
    }

    return { update: update };
}
