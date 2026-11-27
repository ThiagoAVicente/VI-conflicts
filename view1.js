// View 1: maps of Brazil coloured by the deaths and/or the events in each state, in a chosen interval of years.
// Pipeline: load data -> preprocess -> draw -> interaction.
// Libraries: d3 v7 (global object d3), loaded in view1.html.

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

// The two metrics the view can show, alone or together. Each one has its own hue everywhere
// in the view (map, conflict bars, charts): blue for deaths, orange for events (a pair that stays
// apart for colour-blind readers). The map classes are fixed, so colours stay comparable between
// years, and log-like, so Ceara does not wash out every other state.
// The event limits are lower: a state has 12 events in a typical year and 144 in a bad one.
let METRICS = [
    {
        key: "deaths",
        name: "Deaths",
        unit: "deaths",
        singular: "death",
        limits: [ 1, 10, 100, 1000 ],
        colors: [ "#e6e5e1", "#9ec5f4", "#5598e7", "#256abf", "#0d366b" ],
        classNames: [ "0", "1-9", "10-99", "100-999", "1000+" ],
        accent: "#256abf",
        getValue: group => d3.sum(group, d => d.deaths)
    },
    {
        key: "events",
        name: "Events",
        unit: "events",
        singular: "event",
        limits: [ 1, 5, 20, 100 ],
        colors: [ "#e6e5e1", "#fdbe85", "#fd8d3c", "#e6550d", "#a63603" ],
        classNames: [ "0", "1-4", "5-19", "20-99", "100+" ],
        accent: "#e6550d",
        getValue: group => group.length
    }
];

METRICS.forEach(metric => {
    metric.colorScale = d3.scaleThreshold().domain(metric.limits).range(metric.colors);
});

// people who asked their system for less motion get the changes instantly
let REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let events = [],
    geoData,
    minYear,
    maxYear,
    startYear,
    endYear,
    selectedState = null,
    stateGroups = new Map(),
    yearGroups = new Map(),
    playTimer = null,
    activeHandle = null;

let pathMaker,
    maps = [],
    trendCharts = [];


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

Promise.all([ d3.json("data/states.json"), d3.csv("data/brazil.csv") ])
    .then(([ geo, rows ]) => {
        geoData = geo;
        events = prepareEvents(rows);
        setupVis();
    })
    .catch(err => {
        console.log(err);
        d3.select("#map").text("Could not load the data. Start a local server in this folder (python3 -m http.server) and open http://localhost:8000/view1.html");
    });


// ---------------------------------------------------------------- data for the current selection

function getCheckedValues(fieldset) {
    let checked = [];

    d3.selectAll(fieldset + " input:checked").each(function() {
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

// events of the checked types, in every year and every state
function getTypeEvents() {
    let types = getCheckedValues("#typeFilter");

    return events.filter(d => types.includes(d.type));
}

function inYears(year) {
    return year >= startYear && year <= endYear;
}

// events of the selected years and of the checked types (all states)
function getVisibleEvents() {
    return getTypeEvents().filter(d => inYears(d.year));
}

// the place of the panel: the selected state, or the whole country
function inPlace(d) {
    return selectedState === null || d.state === selectedState;
}

function getStateValue(metric, stateCode) {
    return metric.getValue(stateGroups.get(stateCode) || []);
}

// "1,234 deaths, 56 events" with only the metrics shown
function describe(group) {
    return getShownMetrics()
        .map(metric => withUnit(metric, metric.getValue(group)))
        .join(", ");
}

// "1 death", "2 deaths"
function withUnit(metric, value) {
    return formatNumber(value) + " " + (value === 1 ? metric.singular : metric.unit);
}


// ---------------------------------------------------------------- draw

// one map per metric, side by side; the map of a metric that is not shown is hidden
function drawMaps() {
    let projection = d3.geoMercator()
        .fitSize([ MAP_WIDTH, MAP_HEIGHT ], geoData);

    pathMaker = d3.geoPath().projection(projection);

    maps = METRICS.map(metric => {
        let cell = d3.select("#map").append("div").attr("class", "mapCell");

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
                .on("mousemove", showTooltip)
                .on("mouseout", hideTooltip)
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
        let legendTitle = legend.append("span").attr("class", "legendTitle");

        let items = legend.selectAll(".legendItem")
            .data(metric.colors)
            .join("span")
                .attr("class", "legendItem");

        items.append("i").style("background", d => d);
        items.append("text").text((d, i) => metric.classNames[i]);

        return { metric, cell, paths, labels, legendTitle };
    });
}

// one bar per year for every year of the data: the selected years are in the colour of the
// metric, the others grey, so the chart shows where the interval sits in the whole history
function drawTrends() {
    let years = d3.range(minYear, maxYear + 1);
    let base = TREND_HEIGHT - TREND_MARGIN.bottom;

    let x = d3.scaleBand()
        .domain(years)
        .range([ TREND_MARGIN.left, TREND_WIDTH - TREND_MARGIN.right ])
        .paddingInner(0.25);

    trendCharts = METRICS.map(metric => {
        let block = d3.select("#trends").append("div").attr("data-metric", metric.key);

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
                .on("click", (e, year) => { stopPlay(); setYears(year, year); });

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

// colours every map for the current years and filter
function updateMaps() {
    stateGroups = d3.group(getVisibleEvents(), d => d.state);

    maps.forEach(map => {
        let metric = map.metric;

        map.legendTitle.text(metric.name + " in " + formatYears(startYear, endYear) + ":");
        map.paths.classed("selected", d => d.id === selectedState);

        // each state fades from the colour it shows now to the colour of the new years;
        // new years arriving mid-fade interrupt the old fade and start from the current colour
        map.paths.transition("fill")
            .duration(transitionTime())
            .ease(d3.easeCubicInOut)
            .attrTween("fill", function(d) {
                return interpolateFill(this.getAttribute("fill"), metric.colorScale(getStateValue(metric, d.id)));
            });

        // the selected state goes on top so its border is not hidden by the neighbours
        map.paths.filter(d => d.id === selectedState).raise();

        // white codes on the two darkest classes
        map.labels.transition("fill")
            .duration(transitionTime())
            .ease(d3.easeCubicInOut)
            .attr("fill", d => getStateValue(metric, d.id) >= metric.limits[2] ? "#fcfcfb" : "#1a1a19");
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

// fills the side panel for the selected state, or for the whole country
function updatePanel() {
    let list = getVisibleEvents().filter(inPlace);
    let name = selectedState === null
        ? "Brazil"
        : geoData.features.find(d => d.id === selectedState).properties.name;

    d3.select("#panelName").text(name);
    d3.select("#panelYear").text(formatYears(startYear, endYear));

    METRICS.forEach(metric => {
        let total = metric.getValue(list);

        d3.select(metric.key === "deaths" ? "#panelDeaths" : "#panelEvents")
            .transition("count").duration(transitionTime())
            .call(countTo, () => total, value => withUnit(metric, value));
    });

    updateConflicts(list);
}

// the five main conflicts, ranked by the first metric shown, with one bar per metric shown
function updateConflicts(list) {
    let rankBy = getShownMetrics()[0];

    d3.select("#conflictTitle").text("Main conflicts, by " + rankBy.unit);

    let conflicts = d3.rollups(list, group => group, d => d.conflict)
        .map(([ name, group ]) => ({ name, values: new Map(METRICS.map(m => [ m.key, m.getValue(group) ])) }))
        .sort((a, b) => d3.descending(a.values.get(rankBy.key), b.values.get(rankBy.key)) || d3.ascending(a.name, b.name))
        .slice(0, 5);

    let rows = d3.select("#conflictList").selectAll(".conflictRow")
        .data(conflicts, d => d.name)
        .join(enter => {
            let row = enter.append("div").attr("class", "conflictRow");
            row.append("div").attr("class", "conflictName");
            METRICS.forEach(metric => {
                let bar = row.append("div").attr("class", "conflictBar").attr("data-metric", metric.key);
                bar.append("div").style("width", "0%").style("background", metric.accent);
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
        let widthScale = d3.scaleLinear()
            .domain([ 0, d3.max(conflicts, d => d.values.get(metric.key)) || 1 ])
            .range([ 0, 100 ]);

        let bars = rows.select(".conflictBar[data-metric='" + metric.key + "']");

        // tweens the inline width (always in %) and not the computed one (in px)
        bars.select("div").transition("width")
            .duration(transitionTime())
            .ease(d3.easeCubicInOut)
            .styleTween("width", function(d) {
                return d3.interpolateString(this.style.width, widthScale(d.values.get(metric.key)) + "%");
            });
        bars.select("span").transition("count")
            .duration(transitionTime())
            .call(countTo, d => d.values.get(metric.key), value => withUnit(metric, value));
    });
    rows.order();

    d3.select("#conflictList").selectAll(".empty")
        .data(conflicts.length === 0 ? [ 1 ] : [])
        .join("p")
            .attr("class", "empty")
            .text("No events with these filters.");
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
            .attr("fill", year => inYears(year) ? chart.metric.accent : TREND_OUT);
    });
}

// hides every map, chart, bar and number of a metric that is not ticked
function showMetrics() {
    maps.forEach(map => map.cell.style("display", isShown(map.metric.key) ? null : "none"));

    d3.selectAll("[data-metric]").style("display", function() {
        return isShown(this.dataset.metric) ? null : "none";
    });
}

function formatNumber(value) {
    return d3.format(",")(value);
}

function formatYears(first, last) {
    return first === last ? String(first) : first + "-" + last;
}

function updateAll() {
    updateMaps();
    updatePanel();
    updateTrends();
    showMetrics();
}


// ---------------------------------------------------------------- interaction

function handleSelection(stateCode) {
    // clicking the selected state again goes back to the whole country
    selectedState = selectedState === stateCode ? null : stateCode;
    d3.select("#panelHint").style("display", selectedState === null ? "block" : "none");
    updateAll();
}

function showTooltip(e, d) {
    moveTooltip(e, d.properties.name + ", " + formatYears(startYear, endYear) + ": "
        + describe(stateGroups.get(d.id) || []));
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

function setYears(first, last) {
    startYear = clampYear(first);
    endYear = Math.max(startYear, clampYear(last));
    placeHandles(startYear, endYear);
    d3.select("#yearLabel").text(formatYears(startYear, endYear));
    // with every year selected there is nothing to play through
    d3.select("#playButton").property("disabled", startYear === minYear && endYear === maxYear);
    updateAll();
}

// moves both handles and the dark fill between them (fractional years while playing)
function placeHandles(first, last) {
    let position = year => (year - minYear) / (maxYear - minYear);

    d3.select("#startSlider").property("value", first);
    d3.select("#endSlider").property("value", last);

    // the centre of a 20px handle goes from 10px to (width - 10px)
    d3.select("#rangeFill")
        .style("left", "calc(10px + (100% - 20px) * " + position(first) + ")")
        .style("width", "calc((100% - 20px) * " + (position(last) - position(first)) + ")");
}

// keeps the same number of years and moves them back or forward
function shiftYears(delta) {
    let width = endYear - startYear;
    let first = Math.max(minYear, Math.min(maxYear - width, startYear + delta));

    stopPlay();
    setYears(first, first + width);
}

// one handler for both handles; activeHandle remembers which year the current drag moves
function moveHandle() {
    // read the dragged year first: it can be fractional while playing
    let year = Math.round(+this.value);
    stopPlay();

    if ( activeHandle === null ) {
        activeHandle = this.id === "startSlider" ? "start" : "end";
        // on a single year the handles are on top of each other: the direction of the drag
        // tells which one the user wants (left opens the start, right opens the end)
        if ( startYear === endYear ) {
            activeHandle = year < startYear ? "start" : "end";
        }
    }

    if ( activeHandle === "start" ) {
        setYears(Math.min(year, endYear), endYear);
    } else {
        setYears(startYear, Math.max(year, startYear));
    }
}

function stopPlay() {
    if ( playTimer !== null ) {
        playTimer.stop();
        playTimer = null;
        // back to whole years, the handles snap to the years on screen (only after playing:
        // doing it on every call would undo the user's drag before the slider is read)
        d3.selectAll("#startSlider, #endSlider").attr("step", 1);
        placeHandles(startYear, endYear);
    }
    d3.select("#playButton").text("Play");
}

function togglePlay() {
    if ( playTimer !== null ) {
        stopPlay();
        return;
    }

    // the interval keeps its width and slides to the right, like a window over the years
    let width = endYear - startYear;

    if ( endYear === maxYear ) {
        setYears(minYear, minYear + width);
    }

    // the handles work like a video playhead: they move continuously (one year every
    // PLAY_SPEED ms) and the views change each time they pass a whole year
    let firstYear = startYear;
    let lastStart = maxYear - width;

    d3.selectAll("#startSlider, #endSlider").attr("step", "any");
    d3.select("#playButton").text("Pause");

    playTimer = d3.timer(elapsed => {
        let position = Math.min(lastStart, firstYear + elapsed / PLAY_SPEED);

        if ( Math.floor(position) !== startYear ) {
            setYears(Math.floor(position), Math.floor(position) + width);
        }
        placeHandles(position, position + width);

        if ( position >= lastStart ) {
            stopPlay();
        }
    });
}

function setupControls() {
    d3.selectAll("#startSlider, #endSlider")
        .attr("min", minYear)
        .attr("max", maxYear)
        .on("input", moveHandle)
        // a new drag or key press decides again which handle it moves
        .on("pointerdown keydown", () => { activeHandle = null; });

    d3.select("#minYear").text(minYear);
    d3.select("#maxYear").text(maxYear);

    d3.select("#prevButton").on("click", () => shiftYears(-1));
    d3.select("#nextButton").on("click", () => shiftYears(1));
    d3.select("#playButton").on("click", togglePlay);

    d3.selectAll("#typeFilter input").on("change", updateAll);

    d3.selectAll("#metricFilter input").on("change", function() {
        // one metric is always shown: unticking the last one ticks it back
        if ( getShownMetrics().length === 0 ) {
            this.checked = true;
        }
        updateAll();
    });
}

function setupVis() {
    [ minYear, maxYear ] = d3.extent(events, d => d.year);

    drawMaps();
    drawTrends();
    setupControls();

    let year = Math.min(DEFAULT_YEAR, maxYear);
    setYears(year, year);
}
