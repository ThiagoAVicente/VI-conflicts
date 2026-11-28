// View 1: maps of Brazil coloured by the deaths and/or the events in each state, for one year,
// the change between two years or the sum of a range of years.
// Pipeline: load data -> preprocess -> draw -> interaction.
// Libraries: d3 v7 (global object d3), loaded in index.html.

import { enableTrackClick } from "./slider.js";
import { createStateCompare, STATE_COLORS, MAX_STATES } from "./statecompare.js";
import { createHeatmap } from "./heatmap.js";

let DEFAULT_YEAR = 2023,
    MAP_WIDTH = 620,
    MAP_HEIGHT = 600,
    PLAY_SPEED = 800,
    TRANSITION_TIME = 500;

// the bar charts under the details: same size and same x axis, one metric each
let TREND_WIDTH = 320,
    TREND_HEIGHT = 100,
    TREND_MARGIN = { top: 8, right: 12, bottom: 20, left: 30 },
    TREND_OUT = "#c9c8c3";

// every view looks for its elements inside its own part of the page
let root = d3.select("#view1");

// The two metrics the view can show, alone or together, one map each. Each one has its own hue
// everywhere in the view (map, conflict bars, charts): blue for deaths, orange for events (a pair
// that stays apart for colour-blind readers). The map classes are fixed, so colours stay comparable
// between years, and log-like, so Ceara does not wash out every other state.
// The event limits are lower: a state has 12 events in a typical year and 144 in a bad one.
// A range of years adds up more, so it has its own classes, and compare mode its own limit for the change.
let METRICS = [
    {
        key: "deaths",
        name: "Deaths",
        unit: "deaths",
        singular: "death",
        changeLimit: 1000,
        changeTicks: [ -1000, -100, -10, 0, 10, 100, 1000 ],
        colors: [ "#e6e5e1", "#9ec5f4", "#5598e7", "#256abf", "#0d366b" ],
        accent: "#256abf",
        getValue: group => d3.sum(group, d => d.deaths)
    },
    {
        key: "events",
        name: "Events",
        unit: "events",
        singular: "event",
        changeLimit: 100,
        changeTicks: [ -100, -25, -5, 0, 5, 25, 100 ],
        colors: [ "#e6e5e1", "#fdbe85", "#fd8d3c", "#e6550d", "#a63603" ],
        accent: "#e6550d",
        getValue: group => group.length
    }
];

// Compare mode: the maps show the change between two years, fading from grey (no change)
// to blue (fewer) or to red (more). The colour follows the size of the change on a
// log-like (symlog) scale that is fixed at +-changeLimit of the metric, so two comparisons can be compared.
let NO_EVENTS_COLOR = "#e6e5e1";

// the bars of the conflicts in compare mode: red grew, blue shrank (the middle of the two fades above)
let INCREASE_COLOR = "#ec4647",
    DECREASE_COLOR = "#519ced";

let decreaseColors = d3.interpolateRgbBasis([ "#c2c2c2", "#519ced", "#0f4a96" ]),
    increaseColors = d3.interpolateRgbBasis([ "#c2c2c2", "#ec4647", "#9b1c1f" ]);

// t = 0 is the biggest decrease, 0.5 no change and 1 the biggest increase
let changeColors = t => t < 0.5 ? decreaseColors(1 - 2 * t) : increaseColors(2 * t - 1);

METRICS.forEach(metric => {
    // the colour of a state follows its share of the total (the sqrt keeps the small shares visible);
    // the domain is set in updateMaps
    metric.shareScale = d3.scaleSequentialSqrt(d3.interpolateRgbBasis(metric.colors.slice(1)));
    metric.changeScale = d3.scaleDivergingSymlog(changeColors)
        .domain([ -metric.changeLimit, 0, metric.changeLimit ])
        .clamp(true);
});

// people who asked their system for less motion get the changes instantly
let REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let events = [],
    geoData,
    minYear,
    maxYear,
    selectedYear,
    mode = "single",
    baseYear,
    // the states picked on the map (a click adds one, or takes it out), each with a colour for the comparison chart
    selectedStates = [],
    stateColors = new Map(),
    stateGroups = new Map(),
    baseGroups = new Map(),
    yearGroups = new Map(),
    playTimer = null;

let pathMaker,
    maps = [],
    trendCharts = [],
    stateCompare = null,
    heatmap = null;


// ---------------------------------------------------------------- load + preprocess

// keeps the 5 columns of brazil.csv that the view needs, with clean values:
// the state code (same as the map features), the type, the conflict written with "vs" and the deaths
function prepareEvents(rows) {
    let codeByName = new Map(geoData.features.map(d => [ d.properties.name, d.id ]));

    return rows.map(d => {
        return {
            year: +d.year,
            state: codeByName.get(d.adm_1.replace(" state", "")),
            type: d.type_of_violence === "2" ? "faction" : "civilians",
            conflict: d.dyad_name.replace(" - ", " vs "),
            deaths: +d.best
        };
    });
}

// called by main.js when the data is loaded
export function startView1(geo, rows) {
    geoData = geo;
    events = prepareEvents(rows);
    setupVis();
}


// ---------------------------------------------------------------- data for the current selection

function getCheckedValues(selector) {
    let checked = [];

    root.selectAll(selector + " input:checked").each(function() {
        checked.push(this.value);
    });
    return checked;
}

// the metrics ticked by the user, in the order of METRICS (deaths first)
function getShownMetrics() {
    let keys = getCheckedValues("#metricFilter");

    return METRICS.filter(metric => keys.includes(metric.key));
}

// "both" is for the pieces that only make sense with the two metrics (the comma between them)
function isShown(key) {
    let shown = getShownMetrics();

    return key === "both" ? shown.length === METRICS.length : shown.some(metric => metric.key === key);
}

function getCheckedTypes() {
    return getCheckedValues(".typeFilter");
}

// the mode of the slider: "single" (one year), "compare" (the change between two years) or
// "range" (the sum of a period). In the last two there are two handles, whichever is on the left
// is the start and the one on the right the end; in single mode the year is the only handle
function isCompare() {
    return mode === "compare";
}

function getStartYear() {
    return mode === "single" ? selectedYear : Math.min(baseYear, selectedYear);
}

function getEndYear() {
    return mode === "single" ? selectedYear : Math.max(baseYear, selectedYear);
}

// the first and last year of the events on the map: the whole period in range mode, one year in
// the others (in compare mode the end year, the start year is what it is compared with)
function getShownYears() {
    return mode === "range" ? [ getStartYear(), getEndYear() ] : [ getEndYear(), getEndYear() ];
}

// the years marked in the bar charts: the period, the year, or the two compared years
function isSelectedYear(year) {
    if ( isCompare() ) {
        return year === getStartYear() || year === getEndYear();
    }
    return year >= getStartYear() && year <= getEndYear();
}

// "2023", "2010-2020" or "2010 vs 2020"
function getYearLabel() {
    if ( mode === "single" ) {
        return selectedYear;
    }

    return getStartYear() + (isCompare() ? " vs " : "-") + getEndYear();
}

// events of the checked types, in every year and every state
function getTypeEvents() {
    let types = getCheckedTypes();

    return events.filter(d => types.includes(d.type));
}

// events of some years (the ones on the map by default) and of the checked types (all states)
function getVisibleEvents([ from, to ] = getShownYears()) {
    return getTypeEvents().filter(d => d.year >= from && d.year <= to);
}

// the place of the panel: the selected state, or the whole country
function inPlace(d) {
    return selectedStates.length === 0 || selectedStates.includes(d.state);
}

function getStateValue(metric, stateCode, groups = stateGroups) {
    return metric.getValue(groups.get(stateCode) || []);
}

// "1,234 deaths, 56 events" with only the metrics shown
function describe(group) {
    return getShownMetrics()
        .map(metric => withUnit(metric, metric.getValue(group)))
        .join(", ");
}

// "1 death", "2 deaths"; in compare mode the change: "+12 deaths", "-1 event"
function withUnit(metric, value, change = false) {
    return (change ? formatChange(0, value) : formatNumber(value)) + " " + (Math.abs(value) === 1 ? metric.singular : metric.unit);
}


// ---------------------------------------------------------------- draw

// one map per metric, side by side, each with its own legend; the map of a metric that is not shown is hidden
function drawMaps() {
    let projection = d3.geoMercator()
        .fitSize([ MAP_WIDTH, MAP_HEIGHT ], geoData);

    pathMaker = d3.geoPath().projection(projection);

    maps = METRICS.map(metric => {
        let cell = root.select("#map").append("div").attr("class", "mapCell");

        let svg = cell.append("svg")
            .attr("viewBox", [ 0, 0, MAP_WIDTH, MAP_HEIGHT ])
            .attr("role", "img")
            .attr("aria-label", "Map of Brazil coloured by the " + metric.unit + " in each state");

        let paths = svg.append("g").selectAll("path")
            .data(geoData.features)
            .join("path")
                .attr("class", "state")
                .attr("d", d => pathMaker(d))
                .attr("fill", metric.colors[0])
                .on("mouseenter", (e, d) => highlightState(d.id))
                .on("mousemove", showTooltip)
                .on("mouseout", () => {
                    hideTooltip();
                    highlightState(null);
                })
                .on("click", (e, d) => handleSelection(d.id));

        // state codes, only on states big enough to hold them
        let labels = svg.append("g").selectAll("text")
            .data(geoData.features.filter(d => pathMaker.area(d) > 500))
            .join("text")
                .attr("class", "stateLabel")
                .attr("x", d => pathMaker.centroid(d)[0])
                .attr("y", d => pathMaker.centroid(d)[1] + 3)
                .attr("fill", "#1a1a19")
                .text(d => d.id);

        let legend = cell.append("div").attr("class", "mapLegend");

        return { metric, cell, paths, labels, legend };
    });
}

// the legend of the colours in use: the classes of the metric, or the change between the two years
function drawLegend(map) {
    let metric = map.metric;

    if ( isCompare() ) {
        drawChangeLegend(map);
        return;
    }

    // the colour goes from light to dark with the share of the total: a bar, with the shares of some marks
    let legend = map.legend.text(metric.name + " in " + getYearLabel() + ", share of the Brazil total:");

    let max = metric.maxShare * 100,
        position = d3.scaleSqrt().domain([ 0, max ]).range([ 0, 100 ]);

    // the marks of the bar; the last one is the largest share, if no other mark is next to it
    let ticks = [ 0, 1, 5, 10, 25, 50 ].filter(d => d < max * 0.85).concat(max);

    let bar = legend.append("span").attr("class", "changeLegend");

    bar.append("i")
        .attr("class", "changeBar")
        .style("background", "linear-gradient(to right, " + d3.range(11).map(i => metric.shareScale(metric.maxShare * (i / 10) * (i / 10))).join(", ") + ")");
    bar.selectAll("b")
        .data(ticks)
        .join("b")
            .style("left", d => position(d) + "%")
            .text(d => formatPercent(d));

    let none = legend.append("span");

    none.append("i").style("background", NO_EVENTS_COLOR);
    none.append("text").text("No " + metric.unit);
}

// a colour bar from the biggest decrease to the biggest increase, with the changes marked on it
function drawChangeLegend(map) {
    let metric = map.metric;
    let legend = map.legend
        .text("Change in " + metric.unit + " from " + getStartYear() + " to " + getEndYear() + ":");

    let colors = d3.range(11).map(i => changeColors(i / 10));

    // the same log-like scale as the colours, so every mark sits where its colour is
    let position = d3.scaleSymlog()
        .domain([ -metric.changeLimit, metric.changeLimit ])
        .range([ 0, 100 ]);

    let bar = legend.append("span").attr("class", "changeLegend");

    bar.append("i")
        .attr("class", "changeBar")
        .style("background", "linear-gradient(to right, " + colors.join(", ") + ")");
    bar.selectAll("b")
        .data(metric.changeTicks)
        .join("b")
            .style("left", d => position(d) + "%")
            .text(d => d === 0 ? "0" : formatChange(0, d));

    let none = legend.append("span");

    none.append("i").style("background", NO_EVENTS_COLOR);
    none.append("text").text("No events in either year");
}

// one bar per year for every year of the data: the selected years are in the colour of the
// metric, the others grey, so the chart shows where the selection sits in the whole history
function drawTrends() {
    let years = d3.range(minYear, maxYear + 1);
    let base = TREND_HEIGHT - TREND_MARGIN.bottom;

    let x = d3.scaleBand()
        .domain(years)
        .range([ TREND_MARGIN.left, TREND_WIDTH - TREND_MARGIN.right ])
        .paddingInner(0.25);

    trendCharts = METRICS.map(metric => {
        let block = root.select("#trends").append("div").attr("data-metric", metric.key);

        block.append("h3").text(metric.name + " per year");

        let svg = block.append("div").attr("class", "trendChart").append("svg")
            .attr("viewBox", [ 0, 0, TREND_WIDTH, TREND_HEIGHT ])
            .attr("role", "img")
            .attr("aria-label", "Bar chart of the " + metric.unit + " in each year");

        let y = d3.scaleLinear().range([ base, TREND_MARGIN.top ]);

        let grid = svg.append("g")
            .attr("class", "trendGrid")
            .attr("transform", "translate(" + TREND_MARGIN.left + ",0)");

        svg.append("g")
            .attr("class", "trendAxis")
            .attr("transform", "translate(0," + base + ")")
            .call(d3.axisBottom(x)
                .tickValues(years.filter(year => year % 5 === 0))
                .tickSize(3)
                .tickPadding(4));

        let bars = svg.append("g").selectAll("path")
            .data(years)
            .join("path")
                .attr("class", "trendBar")
                .attr("fill", TREND_OUT)
                .attr("d", year => barPath(x(year), base, x.bandwidth(), 0));

        // the hover targets are whole columns, much bigger than the thin bars
        svg.append("g").selectAll("rect")
            .data(years)
            .join("rect")
                .attr("class", "trendHit")
                .attr("x", year => x(year) - x.step() * x.paddingInner() / 2)
                .attr("width", x.step())
                .attr("y", 0)
                .attr("height", base)
                .on("mousemove", showTrendTooltip)
                .on("mouseout", hideTrendTooltip)
                .on("click", (e, year) => showOneYear(year));

        return { metric, x, y, grid, bars, base };
    });
}

// a bar with rounded top corners, standing on the baseline
function barPath(x, base, width, height) {
    let r = Math.min(2, width / 2, height),
        top = base - height;

    return "M" + x + "," + base
        + "V" + (top + r)
        + "Q" + x + "," + top + " " + (x + r) + "," + top
        + "H" + (x + width - r)
        + "Q" + (x + width) + "," + top + " " + (x + width) + "," + (top + r)
        + "V" + base + "Z";
}

// colours every map and rebuilds the state numbers for the current years and filter
function updateMaps() {
    stateGroups = d3.group(getVisibleEvents(), d => d.state);
    baseGroups = isCompare() ? d3.group(getVisibleEvents([ getStartYear(), getStartYear() ]), d => d.state) : new Map();

    maps.forEach(map => {
        let metric = map.metric;

        // the total of the states in the years shown, and the largest share: the colour scale goes up to it
        metric.total = d3.sum(geoData.features, d => getStateValue(metric, d.id));
        metric.maxShare = metric.total === 0 ? 1 : d3.max(geoData.features, d => getStateValue(metric, d.id)) / metric.total;
        metric.shareScale.domain([ 0, metric.maxShare ]);
        drawLegend(map);
        // with two or more states the border has the colour of the line of the state in the comparison
        map.paths.classed("selected", d => isStateSelected(d.id))
            .style("stroke", d => selectedStates.length >= 2 && isStateSelected(d.id) ? STATE_COLORS[stateColors.get(d.id)] : null);

        // each state fades from the colour it shows now to the colour of the new years;
        // new years arriving mid-fade interrupt the old fade and start from the current colour
        map.paths.transition("fill")
            .duration(transitionTime())
            .ease(d3.easeCubicInOut)
            .attrTween("fill", function(d) {
                return interpolateFill(this.getAttribute("fill"), getFill(metric, d.id));
            });

        // the selected state goes on top so its border is not hidden by the neighbours
        map.paths.filter(d => isStateSelected(d.id)).raise();

        map.labels.transition("fill")
            .duration(transitionTime())
            .ease(d3.easeCubicInOut)
            .attr("fill", d => getTextColor(getFill(metric, d.id)));
    });
}

function transitionTime() {
    return REDUCED_MOTION ? 0 : TRANSITION_TIME;
}

// interpolator used to fade a state from one class colour to another.
// Lab is a perceptual colour space: the in-between colours change lightness evenly, so a fade
// reads as "more" or "less" deaths (in RGB the middle of a fade looks greyer and darker).
// Not HCL: the grey of 0 deaths has almost no hue, and HCL would swing through other hues.
function interpolateFill(from, to) {
    return d3.interpolateLab(from, to);
}

// counts the text of each element from the number it shows now to the new one
function countTo(transition, getValue, format) {
    transition.textTween(function(d) {
        let shown = this.__shown || 0;
        let counter = d3.interpolateRound(shown, getValue(d));

        return t => {
            this.__shown = counter(t);
            return format(this.__shown);
        };
    });
}

// the colour of a state on the map of a metric: its class, or in compare mode the change from the start year
function getFill(metric, stateCode) {
    if ( !isCompare() ) {
        let value = getStateValue(metric, stateCode);

        return value === 0 ? NO_EVENTS_COLOR : metric.shareScale(value / metric.total);
    }

    let before = getStateValue(metric, stateCode, baseGroups),
        after = getStateValue(metric, stateCode);

    return before === 0 && after === 0 ? NO_EVENTS_COLOR : metric.changeScale(after - before);
}

// white text on dark fills, dark text on light ones
function getTextColor(fill) {
    return d3.lab(fill).l < 52 ? "#fcfcfb" : "#1a1a19";
}

// "0%", "5%", "12%"; below 10 with a decimal
function formatPercent(value) {
    return (value < 10 && value % 1 !== 0 ? d3.format(".1f")(value) : Math.round(value)) + "%";
}

// "+155", "-562" or "0"
function formatChange(before, after) {
    let difference = after - before;

    return (difference > 0 ? "+" : difference < 0 ? "-" : "") + formatNumber(Math.abs(difference));
}

// fills the side panel for the selected state, or for the whole country
function updatePanel() {
    let list = getVisibleEvents().filter(inPlace);
    // in compare mode: the events of the start year, to see what changed
    let baseList = isCompare() ? getVisibleEvents([ getStartYear(), getStartYear() ]).filter(inPlace) : [];
    let name = selectedStates.length === 0 ? "Brazil"
        : selectedStates.length <= 2 ? selectedStates.map(getStateName).join(" and ")
        : selectedStates.length + " states";

    d3.select("#panelName").text(name);

    // with three states or more the title only has the number: the names go in a line, with the colour of their line
    let names = d3.select("#panelStates").property("hidden", selectedStates.length <= 2).text("");

    if ( selectedStates.length > 2 ) {
        names.selectAll("span")
            .data(selectedStates)
            .join("span")
                .attr("class", "panelState")
                .style("border-left-color", d => STATE_COLORS[stateColors.get(d)])
                .text(getStateName);
    }
    d3.select("#panelYear").text(mode === "single" ? selectedYear : getStartYear() + (isCompare() ? " vs " : " to ") + getEndYear());

    // in compare mode the numbers are the change (+12 deaths, -3 events), and a line gives the two years
    METRICS.forEach(metric => {
        let change = metric.getValue(list) - metric.getValue(baseList);

        d3.select(metric.key === "deaths" ? "#panelDeaths" : "#panelEvents")
            .transition("count").duration(transitionTime())
            .call(countTo, () => change, value => withUnit(metric, value, isCompare()));
    });

    // d3.format writes the minus sign as a long dash, the "-" of formatChange is used instead
    let first = getShownMetrics()[0],
        shown = first.getValue(list),
        baseShown = first.getValue(baseList);
    let percent = baseShown > 0 ? " (" + d3.format("+.0%")(shown / baseShown - 1).replace("−", "-") + " in " + first.unit + ")" : "";

    d3.select("#panelCompare")
        .style("display", isCompare() ? "block" : "none")
        .text(getStartYear() + ": " + describe(baseList) + ". " + getEndYear() + ": " + describe(list) + percent);

    updateConflicts(list, baseList);
}

// the five main conflicts, ranked by the first metric shown (in compare mode by its biggest change),
// with one bar per metric shown
function updateConflicts(list, baseList) {
    let rankBy = getShownMetrics()[0];

    d3.select("#conflictTitle").text(isCompare() ? "Conflicts with the biggest change in " + rankBy.unit
        : "Conflicts with the most " + rankBy.unit + (mode === "range" ? " in the period" : ""));

    let after = d3.group(list, d => d.conflict),
        before = d3.group(baseList, d => d.conflict);

    let conflicts = Array.from(new Set([ ...after.keys(), ...before.keys() ]), name => ({
            name,
            values: new Map(METRICS.map(m => [ m.key, m.getValue(after.get(name) || []) - m.getValue(before.get(name) || []) ]))
        }))
        // in compare mode, only the conflicts that changed
        .filter(d => !isCompare() || getShownMetrics().some(m => d.values.get(m.key) !== 0))
        .sort((a, b) => d3.descending(Math.abs(a.values.get(rankBy.key)), Math.abs(b.values.get(rankBy.key))) || d3.ascending(a.name, b.name))
        .slice(0, 5);

    let rows = d3.select("#conflictList").selectAll(".conflictRow")
        .data(conflicts, d => d.name)
        .join(enter => {
            let row = enter.append("div").attr("class", "conflictRow")
                .attr("role", "button")
                .attr("tabindex", 0)
                .on("click", (e, d) => openConflict(d.name))
                .on("keydown", (e, d) => {
                    if ( e.key === "Enter" || e.key === " " ) {
                        e.preventDefault();
                        openConflict(d.name);
                    }
                });
            row.append("div").attr("class", "conflictName");
            METRICS.forEach(metric => {
                let bar = row.append("div").attr("class", "conflictBar").attr("data-metric", metric.key);
                bar.append("div").style("width", "0%");
                bar.append("span");
            });
            // new conflicts fade in, the ones that stay just resize their bars
            row.style("opacity", 0)
                .transition("fade").duration(transitionTime())
                .style("opacity", 1);
            return row;
        });

    rows.select(".conflictName").text(d => d.name);

    // every metric has its own bar scale: the longest bar is the top value of that metric
    METRICS.forEach(metric => {
        let value = d => d.values.get(metric.key);
        let widthScale = d3.scaleLinear()
            .domain([ 0, d3.max(conflicts, d => Math.abs(value(d))) || 1 ])
            .range([ 0, 100 ]);

        let bars = rows.select(".conflictBar[data-metric='" + metric.key + "']");

        // the bars of the compare mode are red (more) or blue (less); otherwise the hue of the metric
        bars.select("div")
            .style("background", d => isCompare() ? (value(d) > 0 ? INCREASE_COLOR : DECREASE_COLOR) : metric.accent);
        // tweens the inline width (always in %) and not the computed one (in px)
        bars.select("div").transition("width")
            .duration(transitionTime())
            .ease(d3.easeCubicInOut)
            .styleTween("width", function(d) {
                return d3.interpolateString(this.style.width, widthScale(Math.abs(value(d))) + "%");
            });
        bars.select("span").transition("count")
            .duration(transitionTime())
            .call(countTo, value, v => withUnit(metric, v, isCompare()));
    });
    rows.order();

    d3.select("#conflictList").selectAll(".empty")
        .data(conflicts.length === 0 ? [ 1 ] : [])
        .join("p")
            .attr("class", "empty")
            .text(isCompare() ? "No change between these years." : "No events with these filters.");
}

// the bar charts: the same place and types as the panel, but every year
function updateTrends() {
    yearGroups = d3.group(getTypeEvents().filter(inPlace), d => d.year);

    trendCharts.forEach(chart => {
        let getValue = year => chart.metric.getValue(yearGroups.get(year) || []);

        chart.y.domain([ 0, d3.max(chart.bars.data(), getValue) || 1 ]).nice(3);

        // light grid lines across the chart, with the numbers on the left
        chart.grid.transition("axis")
            .duration(transitionTime())
            .call(d3.axisLeft(chart.y)
                .ticks(3)
                .tickSize(-(TREND_WIDTH - TREND_MARGIN.left - TREND_MARGIN.right))
                .tickPadding(4)
                .tickFormat(d3.format("~s")));

        // each bar grows or shrinks from the height it shows now (also when interrupted)
        chart.bars.transition("size")
            .duration(transitionTime())
            .ease(d3.easeCubicInOut)
            .attrTween("d", function(year) {
                let height = d3.interpolateNumber(this.__height || 0, chart.base - chart.y(getValue(year)));

                return t => {
                    this.__height = height(t);
                    return barPath(chart.x(year), chart.base, chart.x.bandwidth(), this.__height);
                };
            });

        chart.bars.transition("fill")
            .duration(transitionTime())
            .attr("fill", year => isSelectedYear(year) ? chart.metric.accent : TREND_OUT);
    });
}

// hides every map, chart, bar and number of a metric that is not ticked
function showMetrics() {
    maps.forEach(map => map.cell.style("display", isShown(map.metric.key) ? null : "none"));

    root.selectAll("[data-metric]").style("display", function() {
        return isShown(this.dataset.metric) ? null : "none";
    });

    let subject = isShown("both") ? "Deaths and events of" : isShown("deaths") ? "Deaths from" : "Events of";

    root.select("#subtitle").text(subject + " organised violence by state. Source: UCDP GED, Brazil events, 1993-2025.");
}

function formatNumber(value) {
    return d3.format(",")(value);
}

function updateAll() {
    updateMaps();
    updatePanel();
    updateTrends();
    showMetrics();
    stateCompare.update(selectedStates);
    heatmap.update();
}


// ---------------------------------------------------------------- interaction

// clicking a conflict of the panel asks main.js to open it in View 2, with the years of the slider
// (the period between the two years in compare mode) and the checked types
function openConflict(conflict) {
    window.dispatchEvent(new CustomEvent("openconflict", {
        detail: {
            conflict: conflict,
            first: getStartYear(),
            last: getEndYear(),
            types: getCheckedTypes()
        }
    }));
}

function isStateSelected(stateCode) {
    return selectedStates.includes(stateCode);
}

function getStateName(stateCode) {
    return geoData.features.find(d => d.id === stateCode).properties.name;
}

// a click adds the state to the selection, or takes it out when it is already in: the details add up
// the states, and the chart under the slider compares them
function handleSelection(stateCode) {
    if ( selectedStates.includes(stateCode) ) {
        selectedStates = selectedStates.filter(d => d !== stateCode);
        stateColors.delete(stateCode);
    } else if ( selectedStates.length < MAX_STATES ) {
        selectedStates = [ ...selectedStates, stateCode ];
        // the first colour that no other selected state has
        let used = Array.from(stateColors.values());

        stateColors.set(stateCode, d3.range(MAX_STATES).find(slot => !used.includes(slot)));
    }
    d3.select("#panelHint").style("display", selectedStates.length === 0 ? "block" : "none");
    d3.select("#clearStates").property("hidden", selectedStates.length === 0);
    updateAll();
}

// the state under the pointer, on a map, in the heatmap or in the comparison: it is highlighted in all of
// them (its outline, its row and its line; the rest of the rows and lines fade)
function highlightState(code) {
    d3.selectAll("#view1 path.state")
        .classed("linked", d => code !== null && d.id === code)
        .filter(d => code !== null && d.id === code)
        .raise();

    if ( heatmap !== null ) {
        heatmap.highlight(code);
    }
    if ( stateCompare !== null ) {
        stateCompare.highlight(code);
    }
}

// takes every state out of the selection (back to Brazil)
function clearStates() {
    selectedStates = [];
    stateColors.clear();
    d3.select("#panelHint").style("display", "block");
    d3.select("#clearStates").property("hidden", true);
    updateAll();
}

d3.select("#clearStates").on("click", clearStates);

function showTooltip(e, d) {
    let text = d.properties.name + ", " + getYearLabel() + ": " + describe(stateGroups.get(d.id) || []);

    if ( isCompare() ) {
        text = d.properties.name + ": " + getShownMetrics().map(metric => {
            let before = getStateValue(metric, d.id, baseGroups),
                after = getStateValue(metric, d.id);

            return formatNumber(before) + " " + metric.unit + " in " + getStartYear() + ", "
                + formatNumber(after) + " in " + getEndYear() + " (" + formatChange(before, after) + ")";
        }).join("; ");
    }

    moveTooltip(e, text);
}

// the hovered year is marked in every chart, so the numbers can be read together
function showTrendTooltip(e, year) {
    trendCharts.forEach(chart => chart.bars.classed("hovered", d => d === year));
    moveTooltip(e, year + ": " + describe(yearGroups.get(year) || []));
}

function hideTrendTooltip() {
    trendCharts.forEach(chart => chart.bars.classed("hovered", false));
    hideTooltip();
}

function moveTooltip(e, text) {
    d3.select("#tooltip")
        .style("display", "block")
        .style("left", (e.clientX + 14) + "px")
        .style("top", (e.clientY + 14) + "px")
        .text(text);
}

function hideTooltip() {
    d3.select("#tooltip").style("display", "none");
}

function clampYear(year) {
    return Math.max(minYear, Math.min(maxYear, year));
}

function setYear(year) {
    selectedYear = clampYear(year);
    showYears();
}

// moves the years on screen: the year in single mode, the start and end of the period otherwise
function setYears(first, last) {
    if ( mode === "single" ) {
        selectedYear = clampYear(first);
    } else {
        baseYear = clampYear(first);
        selectedYear = clampYear(last);
    }
    showYears();
}

function showYears() {
    placeHandles(getStartYear(), getEndYear());
    root.select(".yearLabel").text(getYearLabel());
    // with every year in the range there is nothing to play through
    root.select(".playButton").property("disabled", mode === "range" && getStartYear() === minYear && getEndYear() === maxYear);
    updateAll();
}

// a click on a bar of the charts shows only that year
function showOneYear(year) {
    stopPlay();
    selectedYear = clampYear(year);

    if ( mode === "single" ) {
        setYear(selectedYear);
        return;
    }
    root.select(".controls .modeSwitch input[value='single']").property("checked", true);
    setMode("single");
}

// moves the handles and the dark fill between them (fractional years while playing)
function placeHandles(first, last) {
    if ( mode === "single" ) {
        d3.select("#yearSlider").property("value", first);
        root.select(".rangeFill").style("display", "none");
        return;
    }

    // the two years are not a period: only the handles are shown, without the dark line between them
    let fillShown = !isCompare();

    // the main handle keeps its side: it is the start if it was on the left of the base one
    let mainFirst = selectedYear < baseYear;

    d3.select("#yearSlider").property("value", mainFirst ? first : last);
    d3.select("#baseSlider").property("value", mainFirst ? last : first);

    let position = value => (value - minYear) / (maxYear - minYear);

    // the centre of a 20px handle goes from 10px to (width - 10px)
    root.select(".rangeFill")
        .style("display", fillShown ? null : "none")
        .style("left", "calc(10px + (100% - 20px) * " + position(first) + ")")
        .style("width", "calc((100% - 20px) * " + (position(last) - position(first)) + ")");
}

// also used by main.js, when the view is hidden
export function stopPlay() {
    if ( playTimer !== null ) {
        playTimer.stop();
        playTimer = null;
        // back to whole years, the handles snap to the years on screen (only after playing:
        // doing it on every call would undo the user's drag before the slider is read)
        d3.selectAll("#yearSlider, #baseSlider").attr("step", 1);
        placeHandles(getStartYear(), getEndYear());
    }
    root.select(".playButton").text("Play");
}

function togglePlay() {
    if ( playTimer !== null ) {
        stopPlay();
        return;
    }

    // in range mode the period keeps its width and slides to the right, like a window over the years
    // (in single mode the width is 0: one year after the other)
    let width = getEndYear() - getStartYear();

    if ( getEndYear() === maxYear ) {
        setYears(minYear, minYear + width);
    }

    // the handles work like a video playhead: they move continuously (one year every
    // PLAY_SPEED ms) and the views change each time they pass a whole year
    let firstYear = getStartYear();
    let lastStart = maxYear - width;

    d3.selectAll("#yearSlider, #baseSlider").attr("step", "any");
    root.select(".playButton").text("Pause");

    playTimer = d3.timer(elapsed => {
        let position = Math.min(lastStart, firstYear + elapsed / PLAY_SPEED);

        if ( Math.floor(position) !== getStartYear() ) {
            setYears(Math.floor(position), Math.floor(position) + width);
        }
        placeHandles(position, position + width);

        if ( position >= lastStart ) {
            stopPlay();
        }
    });
}

function setupControls() {
    d3.select("#yearSlider")
        .attr("min", minYear)
        .attr("max", maxYear)
        .on("input", function() {
            // read the dragged year first: it can be fractional while playing
            let year = Math.round(+this.value);
            stopPlay();
            setYear(year);
        });

    root.select(".minYear").text(minYear);
    root.select(".maxYear").text(maxYear);
    enableTrackClick(root.select(".yearRange").node(), minYear, maxYear);

    root.select(".playButton").on("click", togglePlay);

    root.selectAll(".typeFilter input").on("change", updateAll);

    root.selectAll("#metricFilter input").on("change", function() {
        // one metric is always shown: unticking the last one ticks it back
        if ( getShownMetrics().length === 0 ) {
            this.checked = true;
        }
        updateAll();
    });

    setupModes();
}

// the buttons choose the mode of the slider (see isCompare); Compare and Range add a second handle
// and the track between the two handles is filled
function setupModes() {
    d3.select("#baseSlider")
        .attr("min", minYear)
        .attr("max", maxYear)
        .on("input", function() {
            let year = Math.round(+this.value);
            stopPlay();
            baseYear = clampYear(year);
            showYears();
        });

    root.selectAll(".controls .modeSwitch input").on("change", function() {
        setMode(this.value);
    });
}

function setMode(newMode) {
    let before = mode;

    stopPlay();
    mode = newMode;

    // the second handle starts next to the first one: the year before (or after, for the first year)
    if ( before === "single" ) {
        baseYear = selectedYear > minYear ? selectedYear - 1 : selectedYear + 1;
    }

    d3.select("#baseSlider").property("hidden", mode === "single");
    root.select(".yearRange").classed("oneHandle", mode === "single");
    // the player does not run in compare mode, its place stays so the slider does not move
    root.select(".playButton").style("visibility", isCompare() ? "hidden" : null);
    setYear(selectedYear);
}

function setupVis() {
    [ minYear, maxYear ] = d3.extent(events, d => d.year);

    drawMaps();
    drawTrends();

    // the comparison of two states, in the place of the details of one
    stateCompare = createStateCompare(root, {
        getEvents: getTypeEvents,
        getYears: () => [ minYear, maxYear ],
        getTimeline: () => [ getStartYear(), getEndYear() ],
        getShownMetrics: getShownMetrics,
        getName: getStateName,
        formatNumber: formatNumber,
        moveTooltip: moveTooltip,
        hideTooltip: hideTooltip,
        getColor: code => STATE_COLORS[stateColors.get(code)],
        onRemove: code => handleSelection(code),
        onHover: highlightState
    });

    // every state in every year, under the slider
    heatmap = createHeatmap(root, {
        getEvents: getTypeEvents,
        getYears: () => [ minYear, maxYear ],
        getTimeline: () => [ getStartYear(), getEndYear() ],
        isSelectedYear: isSelectedYear,
        getSelected: () => selectedStates,
        metrics: METRICS,
        getName: getStateName,
        getColor: code => STATE_COLORS[stateColors.get(code)],
        formatNumber: formatNumber,
        moveTooltip: moveTooltip,
        hideTooltip: hideTooltip,
        reducedMotion: REDUCED_MOTION,
        onPickState: handleSelection,
        onHoverState: highlightState,
        onPickYear: year => showOneYear(year)
    });
    setupControls();
    setYear(Math.min(DEFAULT_YEAR, maxYear));
}
