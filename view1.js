// View 1: map of Brazil coloured by the deaths in each state, one year at a time.
// Pipeline: load data -> preprocess -> draw -> interaction.
// Libraries: d3 v7 (global object d3), loaded in view1.html.

let DEFAULT_YEAR = 2023,
    MAP_WIDTH = 620,
    MAP_HEIGHT = 600,
    PLAY_SPEED = 800,
    TRANSITION_TIME = 500;

// people who asked their system for less motion get the changes instantly
let REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Fixed classes (0 | 1-9 | 10-99 | 100-999 | 1000+), one blue hue from light to dark.
// A fixed scale keeps colours comparable between years, the log-like classes
// stop Ceara from washing out every other state.
let CLASS_LIMITS = [ 1, 10, 100, 1000 ],
    CLASS_COLORS = [ "#e6e5e1", "#9ec5f4", "#5598e7", "#256abf", "#0d366b" ],
    CLASS_NAMES = [ "0", "1-9", "10-99", "100-999", "1000+" ];

let colorScale = d3.scaleThreshold()
    .domain(CLASS_LIMITS)
    .range(CLASS_COLORS);

let events = [],
    geoData,
    minYear,
    maxYear,
    selectedYear,
    selectedState = null,
    stateStats = new Map(),
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

function getCheckedTypes() {
    let checked = [];

    d3.selectAll("#typeFilter input:checked").each(function() {
        checked.push(this.value);
    });
    return checked;
}

// events of the selected year and of the checked types (all states)
function getVisibleEvents() {
    let types = getCheckedTypes();

    return events.filter(d => d.year === selectedYear && types.includes(d.type));
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

function drawLegend() {
    let items = d3.select("#legend").text("Deaths in the year:").selectAll("span")
        .data(CLASS_COLORS)
        .join("span");

    items.append("i").style("background", d => d);
    items.append("text").text((d, i) => CLASS_NAMES[i]);
}

// colours the map and rebuilds the state numbers for the current year and filter
function updateMap() {
    stateStats = d3.rollup(getVisibleEvents(),
        group => ({ deaths: d3.sum(group, d => d.deaths), events: group.length }),
        d => d.state);

    mapPaths.classed("selected", d => d.id === selectedState);

    // each state fades from the colour it shows now to the colour of the new year;
    // a new year arriving mid-fade interrupts the old fade and starts from the current colour
    mapPaths.transition("fill")
        .duration(transitionTime())
        .ease(d3.easeCubicInOut)
        .attrTween("fill", function(d) {
            return interpolateFill(this.getAttribute("fill"), colorScale(getDeaths(d.id)));
        });

    // the selected state goes on top so its border is not hidden by the neighbours
    mapPaths.filter(d => d.id === selectedState).raise();

    mapLabels.transition("fill")
        .duration(transitionTime())
        .ease(d3.easeCubicInOut)
        .attr("fill", d => getDeaths(d.id) >= CLASS_LIMITS[2] ? "#fcfcfb" : "#1a1a19");
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

function getDeaths(stateCode) {
    return stateStats.has(stateCode) ? stateStats.get(stateCode).deaths : 0;
}

// fills the side panel for the selected state, or for the whole country
function updatePanel() {
    let list = getVisibleEvents();
    let name = "Brazil";

    if ( selectedState !== null ) {
        list = list.filter(d => d.state === selectedState);
        name = geoData.features.find(d => d.id === selectedState).properties.name;
    }

    let deaths = d3.sum(list, d => d.deaths);

    d3.select("#panelName").text(name);
    d3.select("#panelYear").text(selectedYear);
    d3.select("#panelDeaths").transition("count").duration(transitionTime())
        .call(countTo, () => deaths, formatNumber);
    d3.select("#panelEvents").transition("count").duration(transitionTime())
        .call(countTo, () => list.length, formatNumber);

    // the five conflicts with more deaths
    let conflicts = d3.rollups(list, group => d3.sum(group, d => d.deaths), d => d.conflict)
        .sort((a, b) => d3.descending(a[1], b[1]))
        .slice(0, 5);

    let widthScale = d3.scaleLinear()
        .domain([ 0, d3.max(conflicts, d => d[1]) || 1 ])
        .range([ 0, 100 ]);

    let rows = d3.select("#conflictList").selectAll(".conflictRow")
        .data(conflicts, d => d[0])
        .join(enter => {
            let row = enter.append("div").attr("class", "conflictRow");
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
    // tweens the inline width (always in %) and not the computed one (in px)
    rows.select(".conflictBar div").transition("width")
        .duration(transitionTime())
        .ease(d3.easeCubicInOut)
        .styleTween("width", function(d) {
            return d3.interpolateString(this.style.width, widthScale(d[1]) + "%");
        });
    rows.select(".conflictBar span").transition("count")
        .duration(transitionTime())
        .call(countTo, d => d[1], formatNumber);
    rows.order();

    d3.select("#conflictList").selectAll(".empty")
        .data(conflicts.length === 0 ? [ 1 ] : [])
        .join("p")
            .attr("class", "empty")
            .text("No events with these filters.");
}

function formatNumber(value) {
    return d3.format(",")(value);
}

function updateAll() {
    updateMap();
    updatePanel();
}


// ---------------------------------------------------------------- interaction

function handleSelection(stateCode) {
    // clicking the selected state again goes back to the whole country
    selectedState = selectedState === stateCode ? null : stateCode;
    d3.select("#panelHint").style("display", selectedState === null ? "block" : "none");
    updateAll();
}

function showTooltip(e, d) {
    let stats = stateStats.get(d.id) || { deaths: 0, events: 0 };

    d3.select("#tooltip")
        .style("display", "block")
        .style("left", (e.clientX + 14) + "px")
        .style("top", (e.clientY + 14) + "px")
        .text(d.properties.name + ": " + formatNumber(stats.deaths) + " deaths, " + formatNumber(stats.events) + " events");
}

function hideTooltip() {
    d3.select("#tooltip").style("display", "none");
}

function setYear(year) {
    selectedYear = Math.max(minYear, Math.min(maxYear, year));
    d3.select("#yearSlider").property("value", selectedYear);
    d3.select("#yearLabel").text(selectedYear);
    updateAll();
}

function stopPlay() {
    if ( playTimer !== null ) {
        playTimer.stop();
        playTimer = null;
        // back to whole years, the thumb snaps to the year on screen (only after playing:
        // doing it on every call would undo the user's drag before the slider is read)
        d3.select("#yearSlider").attr("step", 1).property("value", selectedYear);
    }
    d3.select("#playButton").text("Play");
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

    d3.select("#playButton").text("Pause");
    playTimer = d3.timer(elapsed => {
        let position = Math.min(maxYear, startYear + elapsed / PLAY_SPEED);

        if ( Math.floor(position) !== selectedYear ) {
            setYear(Math.floor(position));
        }
        slider.property("value", position);

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

    d3.select("#minYear").text(minYear);
    d3.select("#maxYear").text(maxYear);

    d3.select("#prevButton").on("click", () => { stopPlay(); setYear(selectedYear - 1); });
    d3.select("#nextButton").on("click", () => { stopPlay(); setYear(selectedYear + 1); });
    d3.select("#playButton").on("click", togglePlay);

    d3.selectAll("#typeFilter input").on("change", updateAll);
}

function setupVis() {
    [ minYear, maxYear ] = d3.extent(events, d => d.year);

    drawMap();
    drawLegend();
    setupControls();
    setYear(Math.min(DEFAULT_YEAR, maxYear));
}
