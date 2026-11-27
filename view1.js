// View 1: map of Brazil coloured by the deaths in each state, one year at a time.
// Pipeline: load data -> preprocess -> draw -> interaction.
// Libraries: d3 v7 (global object d3), loaded in index.html.

let DEFAULT_YEAR = 2023,
    MAP_WIDTH = 620,
    MAP_HEIGHT = 600,
    PLAY_SPEED = 800,
    TRANSITION_TIME = 500;

// people who asked their system for less motion get the changes instantly
import { enableTrackClick } from "./slider.js";

// every view looks for its elements inside its own part of the page
let root = d3.select("#view1");

let REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// What the map shows: the deaths or the number of events of each state. The keys are also the
// names of the numbers in the state stats. Each one has its own fixed classes (0 | 1-9 | 10-99 ...),
// because there are far fewer events than deaths, its own classes for a range of years (the numbers
// are the sum of the period, so they are bigger) and its own limit for the change in compare mode.
let METRICS = {
    deaths: {
        classLimits: [ 1, 10, 100, 1000 ],
        classNames: [ "0", "1-9", "10-99", "100-999", "1000+" ],
        rangeLimits: [ 1, 100, 1000, 5000 ],
        rangeNames: [ "0", "1-99", "100-999", "1000-4999", "5000+" ],
        changeLimit: 1000,
        changeTicks: [ -1000, -100, -10, 0, 10, 100, 1000 ]
    },
    events: {
        classLimits: [ 1, 5, 25, 100 ],
        classNames: [ "0", "1-4", "5-24", "25-99", "100+" ],
        rangeLimits: [ 1, 25, 100, 500 ],
        rangeNames: [ "0", "1-24", "25-99", "100-499", "500+" ],
        changeLimit: 100,
        changeTicks: [ -100, -25, -5, 0, 5, 25, 100 ]
    }
};

// One blue hue from light to dark. A fixed scale keeps colours comparable between years,
// the log-like classes stop Ceara from washing out every other state.
let CLASS_COLORS = [ "#e6e5e1", "#9ec5f4", "#5598e7", "#256abf", "#0d366b" ];

let colorScale = d3.scaleThreshold()
    .range(CLASS_COLORS);

// Compare mode: the map shows the change between two years, fading from grey (no change)
// to blue (fewer) or to red (more). The colour follows the size of the change on a
// log-like (symlog) scale that is fixed at +-changeLimit of the metric, so two comparisons can be compared.
let NO_EVENTS_COLOR = "#e6e5e1";

// the bars of the conflicts in compare mode: red grew, blue shrank (the middle of the two fades above)
let INCREASE_COLOR = "#ec4647",
    DECREASE_COLOR = "#519ced";

let decreaseColors = d3.interpolateRgbBasis([ "#c2c2c2", "#519ced", "#0f4a96" ]),
    increaseColors = d3.interpolateRgbBasis([ "#c2c2c2", "#ec4647", "#9b1c1f" ]);

// t = 0 is the biggest decrease, 0.5 no change and 1 the biggest increase
let changeScale = d3.scaleDivergingSymlog(t => t < 0.5 ? decreaseColors(1 - 2 * t) : increaseColors(2 * t - 1))
    .clamp(true);

let events = [],
    geoData,
    minYear,
    maxYear,
    selectedYear,
    metric = "deaths",
    selectedState = null,
    stateStats = new Map(),
    mode = "single",
    baseYear,
    statsBase = new Map(),
    playTimer = null;

let mapPaths,
    mapLabels,
    pathMaker;


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

// chooses what the map shows ("deaths" or "events") and sets the scales to it
function setMetric(name) {
    metric = name;

    let limit = METRICS[metric].changeLimit;

    colorScale.domain(getClassLimits());
    changeScale.domain([ -limit, 0, limit ]);

    d3.select("#subtitle").text((metric === "deaths" ? "Deaths from" : "Events of") + " organised violence by state. Source: UCDP GED, Brazil events, 1993-2025.");
    d3.select("#map svg").attr("aria-label", "Map of Brazil coloured by the " + metric + " in each state");
}

function getCheckedTypes() {
    let checked = [];

    root.selectAll(".typeFilter input:checked").each(function() {
        checked.push(this.value);
    });
    return checked;
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

// the classes of the colours: a range of years adds up more deaths than a single year
function getClassLimits() {
    return mode === "range" ? METRICS[metric].rangeLimits : METRICS[metric].classLimits;
}

function getClassNames() {
    return mode === "range" ? METRICS[metric].rangeNames : METRICS[metric].classNames;
}

// "2023", "2010-2020" or "2010 vs 2020"
function getYearLabel() {
    if ( mode === "single" ) {
        return selectedYear;
    }

    return getStartYear() + (isCompare() ? " vs " : "-") + getEndYear();
}

// events of some years (the ones on the map by default) and of the checked types (all states)
function getVisibleEvents([ from, to ] = getShownYears()) {
    let types = getCheckedTypes();

    return events.filter(d => d.year >= from && d.year <= to && types.includes(d.type));
}

// deaths and events of each state in some years
function getStateStats(years) {
    return d3.rollup(getVisibleEvents(years),
        group => ({ deaths: d3.sum(group, d => d.deaths), events: group.length }),
        d => d.state);
}


// ---------------------------------------------------------------- draw

function drawMap() {
    let svg = d3.select("#map").append("svg")
        .attr("viewBox", [ 0, 0, MAP_WIDTH, MAP_HEIGHT ])
        .attr("role", "img")
        .attr("aria-label", "Map of Brazil coloured by deaths in each state");

    let projection = d3.geoMercator()
        .fitSize([ MAP_WIDTH, MAP_HEIGHT ], geoData);

    pathMaker = d3.geoPath().projection(projection);

    mapPaths = svg.append("g").selectAll("path")
        .data(geoData.features)
        .join("path")
            .attr("class", "state")
            .attr("d", d => pathMaker(d))
            .attr("fill", CLASS_COLORS[0])
            .on("mousemove", showTooltip)
            .on("mouseout", hideTooltip)
            .on("click", (e, d) => handleSelection(d.id));

    // state codes, only on states big enough to hold them
    mapLabels = svg.append("g").selectAll("text")
        .data(geoData.features.filter(d => pathMaker.area(d) > 500))
        .join("text")
            .attr("class", "stateLabel")
            .attr("x", d => pathMaker.centroid(d)[0])
            .attr("y", d => pathMaker.centroid(d)[1] + 3)
            .attr("fill", "#1a1a19")
            .text(d => d.id);
}

// the legend of the colours in use: the deaths classes, or the change between the two years
function drawLegend() {
    if ( isCompare() ) {
        drawChangeLegend();
        return;
    }

    // .text() also removes the old items
    let items = d3.select("#legend").text(capitalise(metric) + (mode === "range" ? " in the period:" : " in the year:")).selectAll("span")
        .data(CLASS_COLORS)
        .join("span");

    items.append("i").style("background", d => d);
    items.append("text").text((d, i) => getClassNames()[i]);
}

// a colour bar from the biggest decrease to the biggest increase, with the changes marked on it
function drawChangeLegend() {
    let legend = d3.select("#legend")
        .text("Change in " + metric + " from " + getStartYear() + " to " + getEndYear() + ":");

    let colors = d3.range(11).map(i => changeScale.interpolator()(i / 10));
    let ticks = METRICS[metric].changeTicks;

    // the same log-like scale as the colours, so every mark sits where its colour is
    let position = d3.scaleSymlog()
        .domain([ -METRICS[metric].changeLimit, METRICS[metric].changeLimit ])
        .range([ 0, 100 ]);

    let bar = legend.append("span").attr("class", "changeLegend");

    bar.append("i")
        .attr("class", "changeBar")
        .style("background", "linear-gradient(to right, " + colors.join(", ") + ")");
    bar.selectAll("b")
        .data(ticks)
        .join("b")
            .style("left", d => position(d) + "%")
            .text(d => d === 0 ? "0" : formatChange(0, d));

    let none = legend.append("span");

    none.append("i").style("background", NO_EVENTS_COLOR);
    none.append("text").text("No events in either year");
}

// colours the map and rebuilds the state numbers for the current year and filter
function updateMap() {
    stateStats = getStateStats(getShownYears());
    statsBase = isCompare() ? getStateStats([ getStartYear(), getStartYear() ]) : new Map();

    mapPaths.classed("selected", d => d.id === selectedState);

    // each state fades from the colour it shows now to the colour of the new year;
    // a new year arriving mid-fade interrupts the old fade and starts from the current colour
    mapPaths.transition("fill")
        .duration(transitionTime())
        .ease(d3.easeCubicInOut)
        .attrTween("fill", function(d) {
            return interpolateFill(this.getAttribute("fill"), getFill(d.id));
        });

    // the selected state goes on top so its border is not hidden by the neighbours
    mapPaths.filter(d => d.id === selectedState).raise();

    mapLabels.transition("fill")
        .duration(transitionTime())
        .ease(d3.easeCubicInOut)
        .attr("fill", d => getTextColor(getFill(d.id)));
}

function transitionTime() {
    return REDUCED_MOTION ? 0 : TRANSITION_TIME;
}

// interpolator used to fade a state from one class colour to another
// TODO(human): choose the colour space of the fade (the RGB line below is a placeholder).
// from/to are colour strings (from may be mid-fade, e.g. "rgb(120, 140, 165)").
// Must return a function t (0..1) -> colour string.
function interpolateFill(from, to) {
    return d3.interpolateRgb(from, to);
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

// the number the map shows (deaths or events) for a state
function getValue(stateCode, stats = stateStats) {
    return stats.has(stateCode) ? stats.get(stateCode)[metric] : 0;
}

function capitalise(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// the colour of a state: its deaths class, or in compare mode the change from the base year
function getFill(stateCode) {
    if ( !isCompare() ) {
        return colorScale(getValue(stateCode));
    }

    let before = getValue(stateCode, statsBase),
        after = getValue(stateCode);

    return before === 0 && after === 0 ? NO_EVENTS_COLOR : changeScale(after - before);
}

// white text on dark fills, dark text on light ones
function getTextColor(fill) {
    return d3.lab(fill).l < 52 ? "#fcfcfb" : "#1a1a19";
}

// "+155", "-562" or "0"
function formatChange(before, after) {
    let difference = after - before;

    return (difference > 0 ? "+" : difference < 0 ? "-" : "") + formatNumber(Math.abs(difference));
}

// fills the side panel for the selected state, or for the whole country
function updatePanel() {
    let list = getVisibleEvents();
    // in compare mode: the events of the start year, to see what changed
    let baseList = isCompare() ? getVisibleEvents([ getStartYear(), getStartYear() ]) : [];
    let name = "Brazil";

    if ( selectedState !== null ) {
        list = list.filter(d => d.state === selectedState);
        baseList = baseList.filter(d => d.state === selectedState);
        name = geoData.features.find(d => d.id === selectedState).properties.name;
    }

    let deaths = d3.sum(list, d => d.deaths),
        baseDeaths = d3.sum(baseList, d => d.deaths);
    // the number the map shows, for the same state (or country)
    let shown = metric === "deaths" ? deaths : list.length,
        baseShown = metric === "deaths" ? baseDeaths : baseList.length;

    d3.select("#panelName").text(name);
    d3.select("#panelYear").text(mode === "single" ? selectedYear : getStartYear() + (isCompare() ? " vs " : " to ") + getEndYear());
    d3.select("#conflictTitle").text(isCompare() ? "Conflicts with the biggest change in " + metric
        : "Conflicts with the most " + metric + (mode === "range" ? " in the period" : ""));

    // in compare mode the numbers are the change (+12 deaths, -3 events), and a line gives the two years
    // d3.format writes the minus sign as a long dash, the "-" of formatChange is used instead
    let percent = baseShown > 0 ? " (" + d3.format("+.0%")(shown / baseShown - 1).replace("\u2212", "-") + " in " + metric + ")" : "";
    let format = isCompare() ? d => formatChange(0, d) : formatNumber;

    d3.select("#panelCompare")
        .style("display", isCompare() ? "block" : "none")
        .text(getStartYear() + ": " + formatNumber(baseDeaths) + " deaths, " + formatNumber(baseList.length) + " events. "
            + getEndYear() + ": " + formatNumber(deaths) + " deaths, " + formatNumber(list.length) + " events" + percent);
    d3.select("#panelDeaths").transition("count").duration(transitionTime())
        .call(countTo, () => deaths - baseDeaths, format);
    d3.select("#panelEvents").transition("count").duration(transitionTime())
        .call(countTo, () => list.length - baseList.length, format);

    // the five conflicts with more deaths (or events), or in compare mode with the biggest change
    let value = group => metric === "deaths" ? d3.sum(group, d => d.deaths) : group.length;
    let conflicts;

    if ( isCompare() ) {
        let after = d3.rollup(list, value, d => d.conflict),
            before = d3.rollup(baseList, value, d => d.conflict);

        conflicts = Array.from(new Set([ ...after.keys(), ...before.keys() ]),
                name => [ name, (after.get(name) || 0) - (before.get(name) || 0) ])
            .filter(d => d[1] !== 0)
            .sort((a, b) => d3.descending(Math.abs(a[1]), Math.abs(b[1])))
            .slice(0, 5);
    } else {
        conflicts = d3.rollups(list, value, d => d.conflict)
            .sort((a, b) => d3.descending(a[1], b[1]))
            .slice(0, 5);
    }

    let widthScale = d3.scaleLinear()
        .domain([ 0, d3.max(conflicts, d => Math.abs(d[1])) || 1 ])
        .range([ 0, 100 ]);

    let rows = d3.select("#conflictList").selectAll(".conflictRow")
        .data(conflicts, d => d[0])
        .join(enter => {
            let row = enter.append("div").attr("class", "conflictRow")
                .attr("role", "button")
                .attr("tabindex", 0)
                .on("click", (e, d) => openConflict(d[0]))
                .on("keydown", (e, d) => {
                    if ( e.key === "Enter" || e.key === " " ) {
                        e.preventDefault();
                        openConflict(d[0]);
                    }
                });
            row.append("div").attr("class", "conflictName");
            let bar = row.append("div").attr("class", "conflictBar");
            bar.append("div").style("width", "0%");
            bar.append("span");
            // new conflicts fade in, the ones that stay just resize their bar
            row.style("opacity", 0)
                .transition("fade").duration(transitionTime())
                .style("opacity", 1);
            return row;
        });

    rows.select(".conflictName").text(d => d[0]);
    // the bars of the compare mode are red (more) or blue (less); otherwise the colour of the css
    rows.select(".conflictBar div")
        .style("background", d => isCompare() ? (d[1] > 0 ? INCREASE_COLOR : DECREASE_COLOR) : null);
    // tweens the inline width (always in %) and not the computed one (in px)
    rows.select(".conflictBar div").transition("width")
        .duration(transitionTime())
        .ease(d3.easeCubicInOut)
        .styleTween("width", function(d) {
            return d3.interpolateString(this.style.width, widthScale(Math.abs(d[1])) + "%");
        });
    rows.select(".conflictBar span").transition("count")
        .duration(transitionTime())
        .call(countTo, d => d[1], format);
    rows.order();

    d3.select("#conflictList").selectAll(".empty")
        .data(conflicts.length === 0 ? [ 1 ] : [])
        .join("p")
            .attr("class", "empty")
            .text(isCompare() ? "No change between these years." : "No events with these filters.");
}

function formatNumber(value) {
    return d3.format(",")(value);
}

function updateAll() {
    drawLegend();
    updateMap();
    updatePanel();
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

function handleSelection(stateCode) {
    // clicking the selected state again goes back to the whole country
    selectedState = selectedState === stateCode ? null : stateCode;
    d3.select("#panelHint").style("display", selectedState === null ? "block" : "none");
    updateAll();
}

function showTooltip(e, d) {
    let stats = stateStats.get(d.id) || { deaths: 0, events: 0 };
    let text = d.properties.name + ": " + formatNumber(stats.deaths) + " deaths, " + formatNumber(stats.events) + " events";

    if ( isCompare() ) {
        let before = getValue(d.id, statsBase),
            after = getValue(d.id);

        text = d.properties.name + ": " + formatNumber(before) + " " + metric + " in " + getStartYear() + ", "
            + formatNumber(after) + " in " + getEndYear() + " (" + formatChange(before, after) + ")";
    }

    d3.select("#tooltip")
        .style("display", "block")
        .style("left", (e.clientX + 14) + "px")
        .style("top", (e.clientY + 14) + "px")
        .text(text);
}

function hideTooltip() {
    d3.select("#tooltip").style("display", "none");
}

function setYear(year) {
    selectedYear = Math.max(minYear, Math.min(maxYear, year));
    d3.select("#yearSlider").property("value", selectedYear);
    root.select(".yearLabel").text(getYearLabel());
    updateFill();
    updateAll();
}

// also used by main.js, when the view is hidden
export function stopPlay() {
    if ( playTimer !== null ) {
        playTimer.stop();
        playTimer = null;
        // back to whole years, the thumb snaps to the year on screen (only after playing:
        // doing it on every call would undo the user's drag before the slider is read)
        d3.select("#yearSlider").attr("step", 1).property("value", selectedYear);
    }
    root.select(".playButton").text("Play");
}

function togglePlay() {
    if ( playTimer !== null ) {
        stopPlay();
        return;
    }

    if ( selectedYear === maxYear ) {
        setYear(minYear);
    }

    // the slider works like a video playhead: it moves continuously (one year every
    // PLAY_SPEED ms) and the map changes each time it passes a whole year
    let startYear = selectedYear;
    let slider = d3.select("#yearSlider").attr("step", "any");

    root.select(".playButton").text("Pause");
    playTimer = d3.timer(elapsed => {
        let position = Math.min(maxYear, startYear + elapsed / PLAY_SPEED);

        if ( Math.floor(position) !== selectedYear ) {
            setYear(Math.floor(position));
        }
        slider.property("value", position);
        updateFill(position);

        if ( position >= maxYear ) {
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

    setupModes();

    d3.select("#metricSelect").on("change", function() {
        setMetric(this.value);
        updateAll();
    });
}

// the buttons choose the mode of the slider (see isCompare); Compare and Range add a second handle
// and the track between the two handles is filled
function setupModes() {
    d3.select("#baseSlider")
        .attr("min", minYear)
        .attr("max", maxYear)
        .on("input", function() {
            baseYear = Math.round(+this.value);
            root.select(".yearLabel").text(getYearLabel());
            updateFill();
            updateAll();
        });

    root.selectAll(".modeSwitch input").on("change", function() {
        setMode(this.value);
    });
}

function setMode(newMode) {
    let before = mode;

    mode = newMode;
    stopPlay();

    // the second handle starts next to the first one: the year before (or after, for the first year)
    if ( before === "single" ) {
        baseYear = selectedYear > minYear ? selectedYear - 1 : selectedYear + 1;
    }

    d3.select("#baseSlider").property("hidden", mode === "single").property("value", baseYear);
    root.select(".yearRange").classed("oneHandle", mode === "single");
    // the player only runs in single mode, its place stays so the slider does not move
    root.select(".playButton").style("visibility", mode === "single" ? null : "hidden");
    colorScale.domain(getClassLimits());
    setYear(selectedYear);
}

// the dark fill between the handle of the base year and the one of the year on screen
// (the playhead can be between two years while playing); only with two handles
function updateFill(year = selectedYear) {
    if ( mode === "single" ) {
        root.select(".rangeFill").style("display", "none");
        return;
    }

    let position = value => (value - minYear) / (maxYear - minYear),
        first = Math.min(baseYear, year),
        last = Math.max(baseYear, year);

    // the centre of a 20px handle goes from 10px to (width - 10px)
    root.select(".rangeFill")
        .style("display", null)
        .style("left", "calc(10px + (100% - 20px) * " + position(first) + ")")
        .style("width", "calc((100% - 20px) * " + (position(last) - position(first)) + ")");
}

function setupVis() {
    [ minYear, maxYear ] = d3.extent(events, d => d.year);

    drawMap();
    setMetric(metric);
    drawLegend();
    setupControls();
    setYear(Math.min(DEFAULT_YEAR, maxYear));
}
