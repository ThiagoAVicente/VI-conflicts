// View 2: network of the armed groups (who fought whom) next to a map of the places
// of the selected conflict or group (where). Clicking a link or a group fills the map.
// Pipeline: load data -> preprocess -> draw -> interaction.
// Libraries: d3 v7 (global object d3), loaded in index.html.

let NET_WIDTH = 720,
    NET_HEIGHT = 640,
    MAP_WIDTH = 620,
    MAP_HEIGHT = 600,
    PLAY_SPEED = 900,
    TRANSITION_TIME = 500;

// people who asked their system for less motion get the changes instantly
import { enableTrackClick } from "./slider.js";
import { createCompare } from "./compare.js";

// every view looks for its elements inside its own part of the page
let root = d3.select("#view2");

let REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// UCDP where_prec: 1-3 means the event has a municipality, 4 or more means only the state
// or a wider region. Those records cannot be placed on the map, so the whole view leaves
// them out and says so under the map.
let MAX_PRECISION = 3;

// long names shortened in the labels
let SHORT_NAMES = new Map([ [ "Comando Vermelho", "CV" ] ]);

// colour of the places (the blue of the deaths in View 1)
let PLACE_COLOR = "#256abf";

// size of the places: the area of the dot is the number of deaths and nothing else, so
// the dots of any two selections can be compared (Fortaleza, the largest, has about 1,500 deaths)
let placeRadius = d3.scaleSqrt()
    .domain([ 0, 1500 ])
    .range([ 0, 30 ]);

// the furthest the map zooms in, and the empty margin left around the zoomed state
let MAX_ZOOM = 10,
    ZOOM_PADDING = 0.85;

let events = [],
    impreciseEvents = [],
    geoData,
    minYear,
    maxYear,
    startYear,
    endYear,
    singleYear = false,
    graphGroups = [],
    selectedState = null,
    playTimer = null;

// the node objects are kept between updates, so a group keeps its place in the layout
// when the filters remove it and bring it back
let nodeById = new Map();

// the chart under the slider (see compare.js)
let compare = null;

let simulation,
    linkLayer,
    hitLayer,
    nodeLayer,
    nameLayer,
    dotLayer,
    labelLayer,
    statePaths,
    projection,
    mapZoom,
    mapTransform = d3.zoomIdentity;


// ---------------------------------------------------------------- load + preprocess

// keeps the columns of brazil.csv that the view needs, with clean values;
// stateCode is the id of the state in states.json (as in View 1)
function prepareEvents(rows) {
    let codeByName = new Map(geoData.features.map(d => [ d.properties.name, d.id ]));

    return rows.map(d => {
        return {
            year: +d.year,
            type: d.type_of_violence === "2" ? "faction" : "civilians",
            sideA: d.side_a,
            sideB: d.side_b,
            deaths: +d.best,
            precise: +d.where_prec <= MAX_PRECISION,
            lat: +d.latitude,
            lon: +d.longitude,
            place: d.adm_2.replace(/ municipa?lit?y$/i, ""),
            state: d.adm_1.replace(" state", ""),
            stateCode: codeByName.get(d.adm_1.replace(" state", ""))
        };
    });
}

// called by main.js when the data is loaded
export function startView2(geo, rows) {
    geoData = geo;

    let all = prepareEvents(rows);
    events = all.filter(d => d.precise);
    impreciseEvents = all.filter(d => !d.precise);
    setupVis();
}


// ---------------------------------------------------------------- data for the current selection

function getCheckedTypes() {
    let checked = [];

    root.selectAll(".typeFilter input:checked").each(function() {
        checked.push(this.value);
    });
    return checked;
}

function linkKey(sideA, sideB) {
    return sideA + " vs " + sideB;
}

function shortName(name) {
    return SHORT_NAMES.get(name) || name;
}

// events of the checked types, in the zoomed state (if any), in any year.
// Everything else (network, map, caption, the years of a selection) starts from this list,
// so zooming into a state filters the whole view
function getTypeEvents() {
    let types = getCheckedTypes();

    return events.filter(d => types.includes(d.type)
        && (selectedState === null || d.stateCode === selectedState));
}

// events of the checked types inside the year range
function getVisibleEvents() {
    return getTypeEvents().filter(d => d.year >= startYear && d.year <= endYear);
}

// true if the event is a conflict between two groups of the graph (the same ones as the links)
function inSelection(d) {
    return graphGroups.includes(d.sideA) && graphGroups.includes(d.sideB);
}

// nodes: the groups added to the graph; links: every conflict between two of them (in the range)
function buildGraph() {
    let visible = getVisibleEvents();

    let links = d3.rollups(visible.filter(d => graphGroups.includes(d.sideA) && graphGroups.includes(d.sideB)),
        group => ({
            key: linkKey(group[0].sideA, group[0].sideB),
            source: group[0].sideA,
            target: group[0].sideB,
            type: group[0].type,
            deaths: d3.sum(group, d => d.deaths),
            events: group.length
        }),
        d => linkKey(d.sideA, d.sideB))
        .map(d => d[1]);

    // the numbers of a group count all its conflicts, not only the ones with the groups of the graph
    let nodes = graphGroups.map(name => {
        if ( !nodeById.has(name) ) {
            nodeById.set(name, newNode(name));
        }
        let node = nodeById.get(name),
            mine = visible.filter(d => d.sideA === name || d.sideB === name);

        node.deaths = d3.sum(mine, d => d.deaths);
        node.conflicts = new Set(mine.map(d => linkKey(d.sideA, d.sideB))).size;
        return node;
    });

    // sizes relative to the largest group and conflict of the graph
    let nodeRadius = d3.scaleSqrt()
        .domain([ 0, d3.max(nodes, d => d.deaths) || 1 ])
        .range([ 6, 30 ]);
    let linkWidth = d3.scaleLog()
        .domain([ 1, (d3.max(links, d => d.deaths) || 1) + 1 ])
        .range([ 1.4, 8.4 ]);

    nodes.forEach(d => {
        d.r = nodeRadius(d.deaths);
        d.labelWidth = shortName(d.id).length * 6.2;
    });
    links.forEach(d => d.width = linkWidth(d.deaths + 1));

    return { nodes, links };
}

// a new group starts on a ring around the centre, at an angle taken from its name,
// so the layout looks the same each time the page is opened
function newNode(name) {
    let angle = d3.sum(Array.from(name), c => c.charCodeAt(0)) * 2.4;

    return {
        id: name,
        x: NET_WIDTH / 2 + Math.cos(angle) * 150,
        y: NET_HEIGHT / 2 + Math.sin(angle) * 120
    };
}

// the places of the selected events: one dot per coordinate.
// Inside a zoomed state with nothing selected, all the conflicts of the state are shown
function getPlaces() {
    let list = getVisibleEvents();

    list = list.filter(inSelection);

    let places = d3.rollups(list,
        group => ({
            key: group[0].lat + "," + group[0].lon,
            lat: group[0].lat,
            lon: group[0].lon,
            place: group[0].place,
            state: group[0].state,
            stateCode: group[0].stateCode,
            deaths: d3.sum(group, d => d.deaths),
            events: group.length,
            years: d3.extent(group, d => d.year)
        }),
        d => d.lat + "," + d.lon)
        .map(d => d[1]);

    // the large places are drawn first so the small ones stay on top and can be hovered
    places.sort((a, b) => d3.descending(a.deaths, b.deaths));
    return { list, places };
}

// ---------------------------------------------------------------- draw

function transitionTime() {
    return REDUCED_MOTION ? 0 : TRANSITION_TIME;
}

function drawNetwork() {
    let svg = d3.select("#network").append("svg")
        .attr("viewBox", [ 0, 0, NET_WIDTH, NET_HEIGHT ])
        .attr("role", "img")
        .attr("aria-label", "Network of armed groups, linked by the conflicts between them");

    svg.append("rect")
        .attr("class", "background")
        .attr("width", NET_WIDTH)
        .attr("height", NET_HEIGHT);

    // shown while the graph is empty
    svg.append("text")
        .attr("class", "emptyHint")
        .attr("x", NET_WIDTH / 2)
        .attr("y", NET_HEIGHT / 2)
        .attr("text-anchor", "middle")
        .text("Search for a group, or use Add all, to build the graph");

    linkLayer = svg.append("g");
    hitLayer = svg.append("g");
    nodeLayer = svg.append("g");
    // the names are above every circle and line
    nameLayer = svg.append("g").style("pointer-events", "none");

    simulation = d3.forceSimulation()
        // the link length counts the size of both circles, so two large groups do not touch
        .force("link", d3.forceLink().id(d => d.id).distance(l => 70 + l.source.r + l.target.r).strength(0.3))
        .force("charge", d3.forceManyBody().strength(-520))
        // no two groups, with their names, overlap
        .force("collide", boxCollide())
        // small groups with no link to the rest would drift away without these two
        .force("x", d3.forceX(NET_WIDTH / 2).strength(0.03))
        .force("y", d3.forceY(NET_HEIGHT / 2).strength(0.06))
        .on("tick", paintNetwork);
}

// the box of a group: the circle and its name (on the right of the circle, or on the left near the right edge)
function getBox(d) {
    let side = d.x > NET_WIDTH * 0.6 ? -1 : 1,
        width = 2 * d.r + d.labelWidth + 8;

    return {
        x: d.x + side * (d.labelWidth + 4) / 2,
        y: d.y,
        halfWidth: width / 2 + 3,
        halfHeight: Math.max(d.r, 8) + 3
    };
}

// keeps the groups inside the frame and pushes apart those whose boxes overlap, along the axis with less overlap
function boxCollide() {
    let nodes = [];

    function force() {
        nodes.forEach(d => {
            d.x = Math.max(d.r + 4, Math.min(NET_WIDTH - d.r - 4, d.x));
            d.y = Math.max(d.r + 4, Math.min(NET_HEIGHT - d.r - 4, d.y));
        });

        for ( let pass = 0; pass < 4; pass++ ) {
            for ( let i = 0; i < nodes.length; i++ ) {
                for ( let j = i + 1; j < nodes.length; j++ ) {
                    let a = getBox(nodes[i]),
                        b = getBox(nodes[j]),
                        dx = b.x - a.x,
                        dy = b.y - a.y,
                        overlapX = a.halfWidth + b.halfWidth - Math.abs(dx),
                        overlapY = a.halfHeight + b.halfHeight - Math.abs(dy);

                    if ( overlapX > 0 && overlapY > 0 ) {
                        if ( overlapY < overlapX ) {
                            let move = overlapY / 2 * (dy < 0 ? -1 : 1);
                            nodes[i].y -= move;
                            nodes[j].y += move;
                        } else {
                            let move = overlapX / 2 * (dx < 0 ? -1 : 1);
                            nodes[i].x -= move;
                            nodes[j].x += move;
                        }
                    }
                }
            }
        }
    }

    force.initialize = list => nodes = list;
    return force;
}

// drag a group to move it, a short click (less than 4px) selects it
let dragNode = d3.drag()
    .clickDistance(4)
    .on("start", (e, d) => {
        if ( !e.active ) {
            simulation.alphaTarget(0.3).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
    })
    .on("drag", (e, d) => {
        d.fx = e.x;
        d.fy = e.y;
    })
    .on("end", (e, d) => {
        if ( !e.active ) {
            simulation.alphaTarget(0);
        }
        d.fx = null;
        d.fy = null;
    });

// rebuilds the network for the groups in the graph and the filters, keeping the positions of the groups
function updateNetwork() {
    let { nodes, links } = buildGraph();

    d3.select("#network .emptyHint").style("display", nodes.length === 0 ? null : "none");

    // the link force replaces the names in source/target by the node objects
    simulation.nodes(nodes);
    simulation.force("link").links(links);

    linkLayer.selectAll("line")
        .data(links, d => d.key)
        .join(enter => enter.append("line").attr("stroke-width", 0))
            .attr("class", d => "link " + d.type)
        .transition("width").duration(transitionTime())
            .attr("stroke-width", d => d.width);

    // wide invisible lines on top of the links, so thin links are easy to hover
    hitLayer.selectAll("line")
        .data(links, d => d.key)
        .join("line")
            .attr("class", "hit")
            .on("mousemove", (e, d) => showTooltip(e, shortName(d.source.id) + " vs " + shortName(d.target.id) + ": "
                + formatNumber(d.deaths) + " deaths, " + formatNumber(d.events) + " events"))
            .on("mouseout", hideTooltip);

    nodeLayer.selectAll("g.node")
        .data(nodes, d => d.id)
        .join(enter => {
            let g = enter.append("g")
                .attr("class", "node selected")
                .call(dragNode)
                .on("click", (e, d) => removeGroup(d.id))
                .on("mouseover", (e, d) => highlight(d))
                .on("mousemove", (e, d) => showTooltip(e, d.id + ": " + formatNumber(d.deaths) + " deaths in "
                    + d.conflicts + (d.conflicts === 1 ? " conflict" : " conflicts") + ". Click to take it out"))
                .on("mouseout", () => {
                    hideTooltip();
                    highlight(null);
                });
            g.append("circle").attr("r", 0);
            return g;
        })
        .select("circle").transition("size").duration(transitionTime())
            .attr("r", d => d.r);

    nameLayer.selectAll("text")
        .data(nodes, d => d.id)
        .join("text")
            .attr("class", "nodeName")
            .attr("dy", 4)
            .text(d => shortName(d.id));

    simulation.alpha(0.8).restart();
    paintNetwork();
}

// hovering a group: its links are drawn dark and the others fade, so its conflicts can be followed
function highlight(node) {
    linkLayer.selectAll("line")
        .classed("hot", d => node !== null && (d.source === node || d.target === node))
        .classed("dimmed", d => node !== null && d.source !== node && d.target !== node);
}

// moves the lines and the groups to the positions computed by the simulation
function paintNetwork() {
    nodeLayer.selectAll("g.node").each(d => {
        d.x = Math.max(d.r + 4, Math.min(NET_WIDTH - d.r - 4, d.x));
        d.y = Math.max(d.r + 4, Math.min(NET_HEIGHT - d.r - 4, d.y));
    });

    [ linkLayer, hitLayer ].forEach(layer => {
        layer.selectAll("line")
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);
    });

    let groups = nodeLayer.selectAll("g.node")
        .attr("transform", d => "translate(" + d.x + "," + d.y + ")");

    // names on the right of the circle, or on the left near the right edge
    nameLayer.selectAll("text")
        .attr("text-anchor", d => d.x > NET_WIDTH * 0.6 ? "end" : "start")
        .attr("x", d => d.x + (d.x > NET_WIDTH * 0.6 ? -(d.r + 4) : d.r + 4))
        .attr("y", d => d.y);
}

function drawPlaceMap() {
    let svg = d3.select("#placeMap").append("svg")
        .attr("viewBox", [ 0, 0, MAP_WIDTH, MAP_HEIGHT ])
        .attr("role", "img")
        .attr("aria-label", "Map of Brazil with the places of the selected conflict");

    projection = d3.geoMercator()
        .fitSize([ MAP_WIDTH, MAP_HEIGHT ], geoData);

    // clicking the sea (outside every state) goes back to the whole country
    svg.append("rect")
        .attr("class", "background")
        .attr("width", MAP_WIDTH)
        .attr("height", MAP_HEIGHT)
        .on("click", () => selectState(null));

    // the states are scaled by the zoom; the dots only move and grow a little (see getDotScale),
    // so they are not stretched like the borders
    let stateLayer = svg.append("g");
    labelLayer = svg.append("g").style("pointer-events", "none");
    dotLayer = svg.append("g");

    statePaths = stateLayer.selectAll("path")
        .data(geoData.features)
        .join("path")
            .attr("class", "outline")
            .attr("d", d3.geoPath().projection(projection))
            .on("click", (e, d) => selectState(d.id))
            .on("mousemove", (e, d) => showTooltip(e, selectedState === d.id
                ? "Click to go back to Brazil"
                : "Click to zoom into " + d.properties.name))
            .on("mouseout", hideTooltip);

    // state codes, only on the states big enough to hold them; like the dots they are
    // not scaled by the zoom, they only move (and they are hidden once a state is selected)
    let pathMaker = d3.geoPath().projection(projection);

    labelLayer.selectAll("text")
        .data(geoData.features.filter(d => pathMaker.area(d) > 500))
        .join("text")
            .attr("class", "outlineLabel")
            .attr("x", d => labelPosition(d)[0])
            .attr("y", d => labelPosition(d)[1] + 3)
            .text(d => d.id);

    // only used from the code (no mouse wheel or drag), to animate the zoom
    mapZoom = d3.zoom()
        .on("zoom", e => {
            mapTransform = e.transform;
            stateLayer.attr("transform", mapTransform);
            labelLayer.selectAll("text")
                .attr("x", d => labelPosition(d)[0])
                .attr("y", d => labelPosition(d)[1] + 3);
            dotLayer.selectAll("circle")
                .attr("cx", d => placePosition(d)[0])
                .attr("cy", d => placePosition(d)[1])
                .style("transform", "scale(" + getDotScale() + ")");
        });
}

// how much bigger the dots are when the map is zoomed in: they grow with the square root of the zoom,
// so they follow the map without covering each other (the size is still the deaths at every zoom level)
function getDotScale() {
    return Math.sqrt(mapTransform.k);
}

// position of a place on the screen: projected, then moved by the current zoom
function placePosition(place) {
    return mapTransform.apply(projection([ place.lon, place.lat ]));
}

// position of the code of a state: the centre of the state, moved by the current zoom
function labelPosition(state) {
    return mapTransform.apply(d3.geoPath().projection(projection).centroid(state));
}

// the zoom that fits the selected state in the map, or the identity for the whole country
function getStateTransform() {
    if ( selectedState === null ) {
        return d3.zoomIdentity;
    }

    let feature = geoData.features.find(d => d.id === selectedState);
    let [ [ x0, y0 ], [ x1, y1 ] ] = d3.geoPath().projection(projection).bounds(feature);
    let scale = Math.min(MAX_ZOOM, ZOOM_PADDING / Math.max((x1 - x0) / MAP_WIDTH, (y1 - y0) / MAP_HEIGHT));

    return d3.zoomIdentity
        .translate(MAP_WIDTH / 2, MAP_HEIGHT / 2)
        .scale(scale)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
}

function zoomMap() {
    statePaths
        .classed("selected", d => d.id === selectedState)
        .classed("faded", d => selectedState !== null && d.id !== selectedState);

    labelLayer.style("display", selectedState === null ? null : "none");

    d3.select("#placeMap svg").transition("zoom")
        .duration(REDUCED_MOTION ? 0 : 750)
        .call(mapZoom.transform, getStateTransform());

    d3.select("#zoomOut")
        .style("display", selectedState === null ? "none" : null)
        .text("Back to Brazil");
}

function updatePlaceMap() {
    let { list, places } = getPlaces();

    dotLayer.selectAll("circle")
        .data(places, d => d.key)
        .join(
            enter => enter.append("circle")
                .attr("class", "place")
                .attr("cx", d => placePosition(d)[0])
                .attr("cy", d => placePosition(d)[1])
                .attr("r", 0)
                .attr("fill", PLACE_COLOR),
            update => update,
            exit => exit.transition("size").duration(transitionTime())
                .attr("r", 0)
                .remove())
            .on("mousemove", (e, d) => showTooltip(e, d.place + ", " + d.state + ": " + formatNumber(d.deaths)
                + " deaths in " + formatNumber(d.events) + " events (" + formatYears(d.years) + ")"))
            .on("mouseout", hideTooltip)
            // a dot of the whole-country map zooms into its state; once zoomed, it does nothing
            .on("click", (e, d) => {
                if ( selectedState === null ) {
                    selectState(d.stateCode);
                }
            })
            .order()
            .style("transform", "scale(" + getDotScale() + ")")
        .transition("size").duration(transitionTime())
            .attr("r", d => placeRadius(d.deaths))
            .attr("fill", PLACE_COLOR);

    updatePlaceLegend(places);
    updateCaption(list, places);
}

function updatePlaceLegend(places) {
    let legend = d3.select("#placeLegend").html("");
    // no sample dots: the size has no classes, the area is the deaths. The biggest dot on the map is named instead
    let biggest = d3.greatest(places, d => d.deaths);

    legend.append("span").append("text").text("dot area = deaths" + (selectedState !== null ? " (dots grow with the zoom)" : "") + (biggest
        ? " (biggest here: " + biggest.place + ", " + formatNumber(biggest.deaths) + ")"
        : ""));
}

function updateCaption(list, places) {
    let stateName = selectedState === null ? null : getStateName(selectedState);
    let where = stateName === null ? "" : " in " + stateName;
    let title = "Add groups to the graph with the search box (or Add all) to see where they fought. Click a state on the map to zoom into it.";
    let numbers = "";

    if ( graphGroups.length === 1 ) {
        title = "Add another group to see the conflicts between them";
    } else if ( graphGroups.length > 1 ) {
        title = "Conflicts between " + (graphGroups.length <= 4 ? graphGroups.map(shortName).join(", ")
            : formatNumber(graphGroups.length) + " groups") + where;
    } else if ( stateName !== null ) {
        title = "Add groups to the graph to see where they fought in " + stateName;
    }

    if ( graphGroups.length > 0 ) {
        if ( list.length === 0 ) {
            numbers = "No events with an exact place in " + formatYears([ startYear, endYear ]) + " for these types.";
        } else {
            numbers = formatNumber(d3.sum(list, d => d.deaths)) + " deaths · "
                + formatNumber(list.length) + " events · "
                + formatNumber(places.length) + " places · "
                + formatYears(d3.extent(list, d => d.year));
        }
    }

    d3.select("#captionTitle").text(title).classed("hint", graphGroups.length === 0);
    d3.select("#captionNumbers").text(numbers);

    // the records left out, counted for the zoomed state only
    let left = impreciseEvents.filter(d => selectedState === null || d.stateCode === selectedState);

    d3.select("#captionNote").text(left.length === 0
        ? "All the records" + where + " have an exact place."
        : "Records with only a state-level location (" + formatNumber(left.length) + " records, "
            + formatNumber(d3.sum(left, d => d.deaths)) + " deaths" + where + ") are not in this view.");

    d3.select("#mapTitle").text(stateName === null ? "Brazil" : stateName);
    d3.select("#networkTitle").text(stateName === null
        ? "Groups and conflicts in Brazil"
        : "Only the groups and conflicts in " + stateName);
    d3.select("#clearGraph").property("disabled", graphGroups.length === 0);
}

function formatNumber(value) {
    return d3.format(",")(value);
}

function formatYears([ first, last ]) {
    return first === last ? String(first) : first + "-" + last;
}

function updateAll() {
    updateNetwork();
    updatePlaceMap();

    if ( compare !== null ) {
        compare.update();
    }
}


// ---------------------------------------------------------------- interaction

// the events in focus, in any year: those of the graph (all of them while it is empty),
// of the checked types, inside the zoomed state if there is one
function getFocusEvents() {
    let list = getTypeEvents();

    return graphGroups.length === 0 ? list : list.filter(inSelection);
}

// moves the slider to the years of the events in focus, so changing the graph or
// zooming into a state always shows the whole period it was active.
// In single year mode the year stays where it is (and the player keeps going): the user is
// watching the graph year by year, and changing it must not take that mode away
function jumpToFocusYears() {
    let years = getFocusEvents().map(d => d.year);

    if ( singleYear || years.length === 0 ) {
        updateAll();
        return;
    }

    stopPlay();
    singleYear = d3.min(years) === d3.max(years);
    setYears(d3.min(years), d3.max(years));
}

// called by main.js when a conflict is clicked in View 1: the graph gets the two groups of the
// conflict, in the same years (one year: single mode; otherwise range) and with the same types,
// in the whole country
export function showConflict(conflict, first, last, types) {
    let event = events.find(d => linkKey(d.sideA, d.sideB) === conflict);

    stopPlay();
    hideTooltip();
    root.selectAll(".typeFilter input").property("checked", function() {
        return types.includes(this.value);
    });

    if ( selectedState !== null ) {
        selectedState = null;
        zoomMap();
    }

    graphGroups = event === undefined ? [] : [ event.sideA, event.sideB ];
    compare.setGroups(graphGroups, true);

    singleYear = first === last;
    updateModeSwitch();
    setYears(first, last);
}

// the graph changed: the chart under the slider compares its groups (the first few, or the ones
// with most deaths when "top" is true) and the slider goes to the years of the graph
function graphChanged(top, keepYears) {
    compare.setGroups(top ? compare.topGroups() : graphGroups, true);

    if ( keepYears ) {
        updateAll();
    } else {
        jumpToFocusYears();
    }
}

function addGroup(name) {
    if ( !graphGroups.includes(name) ) {
        graphGroups = [ ...graphGroups, name ];
        graphChanged(false, false);
    }
}

// clicking a node takes it out of the graph
function removeGroup(name) {
    graphGroups = graphGroups.filter(d => d !== name);
    hideTooltip();
    graphChanged(false, false);
}

// every group with events of the checked types (in the zoomed state), in any year
function addAllGroups() {
    let names = new Set();

    getTypeEvents().forEach(d => {
        names.add(d.sideA);
        names.add(d.sideB);
    });

    graphGroups = Array.from(names);
    graphChanged(true, true);
}

function clearGraph() {
    graphGroups = [];
    hideTooltip();
    graphChanged(false, true);
}

// the groups were picked in the chart: the graph gets them too (the groups the chart does not
// compare, the civilians, are not touched by the chart)
function pickGroups(names) {
    let kept = graphGroups.filter(name => names.includes(name) || !compare.canPick(name));

    graphGroups = [ ...kept, ...names.filter(name => !kept.includes(name)) ];
    updateAll();
}

// zooms into a state (or back to Brazil with null) and filters the network and the map to it;
// clicking the zoomed state again goes back, like in View 1
function selectState(stateCode) {
    selectedState = selectedState === stateCode ? null : stateCode;

    hideTooltip();
    zoomMap();
    jumpToFocusYears();
}

function getStateName(stateCode) {
    return geoData.features.find(d => d.id === stateCode).properties.name;
}

function showTooltip(e, text) {
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
    endYear = singleYear ? startYear : clampYear(last);
    updateSliders();
    updateAll();
}

// the mode buttons (Single or Range) follow the state, which also changes by itself when something is selected
function updateModeSwitch() {
    root.selectAll(".controls .modeSwitch input").property("checked", function() {
        return (this.value === "single") === singleYear;
    });
}

// moves both handles, the dark fill between them and the label
function updateSliders() {
    let position = year => (year - minYear) / (maxYear - minYear);
    let p0 = position(startYear),
        p1 = position(endYear);

    d3.select("#startSlider").property("value", startYear);
    d3.select("#endSlider").property("value", endYear).style("display", singleYear ? "none" : null);

    // the centre of a 20px handle goes from 10px to (width - 10px)
    root.select(".rangeFill")
        .style("display", singleYear ? "none" : null)
        .style("left", "calc(10px + (100% - 20px) * " + p0 + ")")
        .style("width", "calc((100% - 20px) * " + (p1 - p0) + ")");

    // when the handles meet at the end, the first one goes on top so it can still be dragged back
    d3.select("#startSlider").style("z-index", startYear === maxYear ? 2 : null);

    root.select(".yearLabel").text(formatYears([ startYear, endYear ]));
    root.select(".yearRange").classed("oneHandle", singleYear);
    root.select(".playButton").style("visibility", singleYear ? null : "hidden");
    updateModeSwitch();
}

// also used by main.js, when the view is hidden
export function stopPlay() {
    if ( playTimer !== null ) {
        playTimer.stop();
        playTimer = null;
        // back to whole years (only after playing: doing it on every call would undo
        // the user's drag before the slider is read)
        d3.select("#startSlider").attr("step", 1).property("value", startYear);
    }
    root.select(".playButton").text("Play");
}

// same player as View 1: the handle moves continuously and the views change at each whole year
function togglePlay() {
    if ( playTimer !== null ) {
        stopPlay();
        return;
    }

    if ( startYear === maxYear ) {
        setYears(minYear, minYear);
    }

    let firstYear = startYear;
    let slider = d3.select("#startSlider").attr("step", "any");

    root.select(".playButton").text("Pause");
    playTimer = d3.timer(elapsed => {
        let position = Math.min(maxYear, firstYear + elapsed / PLAY_SPEED);

        if ( Math.floor(position) !== startYear ) {
            setYears(Math.floor(position), Math.floor(position));
        }
        slider.property("value", position);

        if ( position >= maxYear ) {
            stopPlay();
        }
    });
}

function setupControls() {
    d3.selectAll("#startSlider, #endSlider")
        .attr("min", minYear)
        .attr("max", maxYear);

    d3.select("#startSlider").on("input", function() {
        // read the dragged year first: it can be fractional while playing
        let year = Math.round(+this.value);
        stopPlay();
        setYears(singleYear ? year : Math.min(year, endYear), endYear);
        this.value = startYear;
    });

    d3.select("#endSlider").on("input", function() {
        setYears(startYear, Math.max(+this.value, startYear));
        this.value = endYear;
    });

    root.select(".minYear").text(minYear);
    root.select(".maxYear").text(maxYear);
    enableTrackClick(root.select(".yearRange").node(), minYear, maxYear);

    root.selectAll(".controls .modeSwitch input").on("change", function() {
        stopPlay();
        singleYear = this.value === "single";

        if ( singleYear ) {
            setYears(startYear, startYear);
        } else {
            // back to a range: the years of what is in focus, or all the years
            let years = getFocusEvents().map(d => d.year);
            setYears(d3.min(years) || minYear, d3.max(years) || maxYear);
        }
    });

    root.select(".playButton").on("click", togglePlay);
    d3.select("#zoomOut").on("click", () => selectState(null));
    d3.select("#selectAll").on("click", addAllGroups);
    d3.select("#clearGraph").on("click", clearGraph);
    root.selectAll(".typeFilter input").on("change", updateAll);
}

// ---------------------------------------------------------------- search

// the box above the network: the groups that are not in the graph yet, the ones with more events
// first (all of them when the box is empty); a click or Enter adds the group to the graph
function setupSearch() {
    let input = d3.select("#groupSearch"),
        list = d3.select("#searchResults"),
        active = -1,
        matches = [];

    let eventsByGroup = new Map();

    events.forEach(d => {
        [ d.sideA, d.sideB ].forEach(name => eventsByGroup.set(name, (eventsByGroup.get(name) || 0) + 1));
    });

    // lower case and without accents, so "ceara" finds "Ceará"
    let simple = text => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    let groups = Array.from(eventsByGroup, d => ({ name: d[0], events: d[1], text: simple(d[0] + " " + shortName(d[0])) }))
        .sort((a, b) => d3.descending(a.events, b.events) || d3.ascending(a.name, b.name));

    function close() {
        list.property("hidden", true);
        input.attr("aria-expanded", "false");
        active = -1;
    }

    // the box stays open, to add the next group
    function choose(name) {
        input.property("value", "");
        addGroup(name);
        showMatches();
    }

    function showMatches() {
        let query = simple(input.property("value").trim());

        matches = groups.filter(d => !graphGroups.includes(d.name) && d.text.includes(query)).slice(0, 8);
        active = matches.length > 0 ? 0 : -1;
        draw();
    }

    function draw() {
        list.selectAll("li")
            .data(matches, d => d.name)
            .join("li")
                .attr("role", "option")
                .classed("active", (d, i) => i === active)
                .text(d => shortName(d.name) + (shortName(d.name) !== d.name ? " (" + d.name + ")" : "") + " · " + formatNumber(d.events) + " events")
                .on("mousedown", (e, d) => {
                    // before the input loses the focus
                    e.preventDefault();
                    choose(d.name);
                });

        let empty = input.property("value").trim() !== "" && matches.length === 0;

        list.selectAll("li.none")
            .data(empty ? [ 1 ] : [])
            .join("li")
                .attr("class", "none")
                .text("No group with that name");

        list.property("hidden", matches.length === 0 && !empty);
        input.attr("aria-expanded", String(matches.length > 0));
    }

    input.on("input", showMatches)
        .on("focus", showMatches)
        .on("blur", close)
        .on("keydown", e => {
            if ( e.key === "ArrowDown" || e.key === "ArrowUp" ) {
                e.preventDefault();
                if ( matches.length > 0 ) {
                    active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
                    draw();
                }
            } else if ( e.key === "Enter" && active >= 0 ) {
                choose(matches[active].name);
            } else if ( e.key === "Escape" ) {
                input.property("value", "");
                close();
            }
        });
}

function setupVis() {
    [ minYear, maxYear ] = d3.extent(events, d => d.year);
    startYear = minYear;
    endYear = maxYear;

    drawNetwork();
    drawPlaceMap();
    setupControls();
    setupSearch();

    // the chart under the slider: the groups, the events of the checked types in the zoomed state,
    // and the years of the slider (what the rest of the view uses)
    compare = createCompare(root, {
        getAllEvents: () => events,
        getEvents: getTypeEvents,
        getPeriod: () => [ minYear, maxYear ],
        getYears: () => ({ first: startYear, last: endYear, single: singleYear }),
        onPick: pickGroups,
        getDataKey: () => getCheckedTypes().join() + "|" + selectedState,
        getScope: () => selectedState === null ? "" : getStateName(selectedState),
        shortName: shortName
    });

    zoomMap();

    // starts with nothing selected, in all the years
    updateAll();
    updateSliders();

    // the first layout is computed before it is shown, so the page does not open with
    // every group flying into place; later changes are animated
    simulation.stop();
    simulation.tick(300);
    paintNetwork();
    simulation.restart();
}
