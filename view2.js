// View 2: network of the armed groups (who fought whom) next to a map of the places
// of the selected conflict or group (where). Clicking a link or a group fills the map.
// Pipeline: load data -> preprocess -> draw -> interaction.
// Libraries: d3 v7 (global object d3), loaded in view2.html.

let NET_WIDTH = 640,
    NET_HEIGHT = 520,
    MAP_WIDTH = 620,
    MAP_HEIGHT = 600,
    PLAY_SPEED = 900,
    TRANSITION_TIME = 500;

// people who asked their system for less motion get the changes instantly
let REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// UCDP where_prec: 1-3 means the event has a municipality, 4 or more means only the state
// or a wider region. Those records cannot be placed on the map, so the whole view leaves
// them out and says so under the map.
let MAX_PRECISION = 3;

// long names shortened in the labels
let SHORT_NAMES = new Map([ [ "Comando Vermelho", "CV" ] ]);

// the typical year of a place, from the first year of the range (light) to the last (dark),
// with the same blues as View 1
let YEAR_COLORS = [ "#9ec5f4", "#5598e7", "#256abf", "#0d366b" ];

// fixed size for the places (Fortaleza, the largest, has about 1,500 deaths),
// so the dots of two conflicts can be compared
let placeRadius = d3.scaleSqrt()
    .domain([ 0, 1500 ])
    .range([ 3, 30 ])
    .clamp(true);

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
    selection = null,
    selectedState = null,
    playTimer = null;

// the node objects are kept between updates, so a group keeps its place in the layout
// when the filters remove it and bring it back
let nodeById = new Map();

let simulation,
    linkLayer,
    hitLayer,
    nodeLayer,
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

Promise.all([ d3.json("data/states.json"), d3.csv("data/brazil.csv") ])
    .then(([ geo, rows ]) => {
        geoData = geo;

        let all = prepareEvents(rows);
        events = all.filter(d => d.precise);
        impreciseEvents = all.filter(d => !d.precise);
        setupVis();
    })
    .catch(err => {
        console.log(err);
        d3.select("#network").text("Could not load the data. Start a local server in this folder (python3 -m http.server) and open http://localhost:8000/view2.html");
    });


// ---------------------------------------------------------------- data for the current selection

function getCheckedTypes() {
    let checked = [];

    d3.selectAll("#typeFilter input:checked").each(function() {
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

// true if the event is part of the selected conflict, or of any conflict of the selected group
function inSelection(d) {
    if ( selection === null ) {
        return false;
    }
    if ( selection.type === "all" ) {
        return true;
    }
    if ( selection.type === "link" ) {
        return linkKey(d.sideA, d.sideB) === selection.key;
    }
    return d.sideA === selection.id || d.sideB === selection.id;
}

// links: one per conflict pair, nodes: one per group, both with the deaths in the range
function buildGraph() {
    let links = d3.rollups(getVisibleEvents(),
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

    let deathsByGroup = new Map();
    let conflictsByGroup = new Map();

    links.forEach(link => {
        [ link.source, link.target ].forEach(name => {
            deathsByGroup.set(name, (deathsByGroup.get(name) || 0) + link.deaths);
            conflictsByGroup.set(name, (conflictsByGroup.get(name) || 0) + 1);
        });
    });

    let nodes = Array.from(deathsByGroup, ([ name, deaths ]) => {
        if ( !nodeById.has(name) ) {
            nodeById.set(name, newNode(name));
        }
        let node = nodeById.get(name);
        node.deaths = deaths;
        node.conflicts = conflictsByGroup.get(name);
        return node;
    });

    // sizes relative to the largest group and conflict in the range, like the sketch
    let nodeRadius = d3.scaleSqrt()
        .domain([ 0, d3.max(nodes, d => d.deaths) || 1 ])
        .range([ 6, 30 ]);
    let linkWidth = d3.scaleLog()
        .domain([ 1, (d3.max(links, d => d.deaths) || 1) + 1 ])
        .range([ 1.4, 8.4 ]);

    nodes.forEach(d => d.r = nodeRadius(d.deaths));
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

    if ( selection !== null || selectedState === null ) {
        list = list.filter(inSelection);
    }

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
            years: d3.extent(group, d => d.year),
            typicalYear: getTypicalYear(group)
        }),
        d => d.lat + "," + d.lon)
        .map(d => d[1]);

    // the large places are drawn first so the small ones stay on top and can be hovered
    places.sort((a, b) => d3.descending(a.deaths, b.deaths));
    return { list, places };
}

// the year that best describes when a place was active: the mean year of its events,
// weighted by deaths (an event with 0 deaths still counts once)
function getTypicalYear(group) {
    let weight = d => Math.max(d.deaths, 1);

    return d3.sum(group, d => d.year * weight(d)) / d3.sum(group, weight);
}

function getYearColor(year) {
    if ( startYear === endYear ) {
        return YEAR_COLORS[YEAR_COLORS.length - 1];
    }
    return d3.scaleQuantize()
        .domain([ startYear, endYear ])
        .range(YEAR_COLORS)(year);
}


// ---------------------------------------------------------------- selection state

function isActiveLink(link) {
    if ( selection === null ) {
        return true;
    }
    if ( selection.type === "all" ) {
        return true;
    }
    if ( selection.type === "link" ) {
        return link.key === selection.key;
    }
    return link.source.id === selection.id || link.target.id === selection.id;
}

function isSelectedNode(node) {
    if ( selection === null ) {
        return false;
    }
    if ( selection.type === "all" ) {
        return true;
    }
    if ( selection.type === "link" ) {
        return node.id === selection.source || node.id === selection.target;
    }
    return node.id === selection.id;
}

// groups that fought the selected group
function isRelatedNode(node, links) {
    if ( selection === null || selection.type !== "node" || node.id === selection.id ) {
        return false;
    }
    return links.some(l => isActiveLink(l) && (l.source.id === node.id || l.target.id === node.id));
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

    // clicking the empty background clears the selection
    svg.append("rect")
        .attr("class", "background")
        .attr("width", NET_WIDTH)
        .attr("height", NET_HEIGHT)
        .on("click", () => select(null));

    linkLayer = svg.append("g");
    hitLayer = svg.append("g");
    nodeLayer = svg.append("g");

    simulation = d3.forceSimulation()
        // the link length counts the size of both circles, so two large groups do not touch
        .force("link", d3.forceLink().id(d => d.id).distance(l => 70 + l.source.r + l.target.r).strength(0.3))
        .force("charge", d3.forceManyBody().strength(-380))
        .force("collide", d3.forceCollide(d => d.r + 10))
        // small groups with no link to the rest would drift away without these two
        .force("x", d3.forceX(NET_WIDTH / 2).strength(0.035))
        .force("y", d3.forceY(NET_HEIGHT / 2).strength(0.06))
        .on("tick", paintNetwork);
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

// rebuilds the network for the current filters, keeping the positions of the groups
function updateNetwork() {
    let { nodes, links } = buildGraph();

    // the link force replaces the names in source/target by the node objects
    simulation.nodes(nodes);
    simulation.force("link").links(links);

    linkLayer.selectAll("line")
        .data(links, d => d.key)
        .join(enter => enter.append("line").attr("stroke-width", 0))
            .attr("class", d => "link " + d.type)
            .classed("active", d => selection !== null && isActiveLink(d))
            .classed("faded", d => selection !== null && !isActiveLink(d))
        .transition("width").duration(transitionTime())
            .attr("stroke-width", d => selection !== null && isActiveLink(d) ? d.width + 2 : d.width);

    // wide invisible lines on top of the links, so thin links are easy to click
    hitLayer.selectAll("line")
        .data(links, d => d.key)
        .join("line")
            .attr("class", "hit")
            .on("click", (e, d) => select({ type: "link", key: d.key, source: d.source.id, target: d.target.id }))
            .on("mousemove", (e, d) => showTooltip(e, shortName(d.source.id) + " vs " + shortName(d.target.id) + ": "
                + formatNumber(d.deaths) + " deaths, " + formatNumber(d.events) + " events"))
            .on("mouseout", hideTooltip);

    let groups = nodeLayer.selectAll("g.node")
        .data(nodes, d => d.id)
        .join(enter => {
            let g = enter.append("g")
                .attr("class", "node")
                .call(dragNode)
                .on("click", (e, d) => select({ type: "node", id: d.id }))
                .on("mousemove", (e, d) => showTooltip(e, d.id + ": " + formatNumber(d.deaths) + " deaths in "
                    + d.conflicts + (d.conflicts === 1 ? " conflict" : " conflicts")))
                .on("mouseout", hideTooltip);
            g.append("circle").attr("r", 0);
            g.append("text").attr("y", 4).text(d => shortName(d.id));
            return g;
        });

    groups
        .classed("selected", d => isSelectedNode(d))
        .classed("related", d => isRelatedNode(d, links));

    groups.select("circle").transition("size").duration(transitionTime())
        .attr("r", d => d.r);

    simulation.alpha(0.5).restart();
    paintNetwork();
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

    // labels on the right of the circle, or on the left near the right edge
    groups.select("text")
        .attr("text-anchor", d => d.x > NET_WIDTH * 0.6 ? "end" : "start")
        .attr("x", d => d.x > NET_WIDTH * 0.6 ? -(d.r + 4) : d.r + 4);
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

    // the states are scaled by the zoom; the dots are not, they only move,
    // so a place keeps the same size (= deaths) at every zoom level
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
                .attr("cy", d => placePosition(d)[1]);
        });
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
                .attr("fill", d => getYearColor(d.typicalYear)),
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
        .transition("size").duration(transitionTime())
            .attr("r", d => placeRadius(d.deaths))
            .attr("fill", d => getYearColor(d.typicalYear));

    updatePlaceLegend();
    updateCaption(list, places);
}

function updatePlaceLegend() {
    let legend = d3.select("#placeLegend").html("");
    let sizes = legend.append("span");
    let svg = sizes.append("svg").attr("width", 90).attr("height", 34);

    [ 1, 100, 1000 ].forEach((deaths, i) => {
        svg.append("circle")
            .attr("class", "place")
            .attr("cx", [ 6, 24, 62 ][i])
            .attr("cy", 17)
            .attr("r", placeRadius(deaths) * (i === 2 ? 0.6 : 1))
            .attr("fill", "#e6e5e1");
    });
    sizes.append("text").text("deaths per place (1, 100, 1000)");

    if ( startYear !== endYear ) {
        let years = legend.append("span");
        years.append("text").text(startYear);
        YEAR_COLORS.forEach(c => years.append("i").style("background", c));
        years.append("text").text(endYear + " (typical year of the place)");
    }
}

function updateCaption(list, places) {
    let stateName = selectedState === null ? null : getStateName(selectedState);
    let where = stateName === null ? "" : " in " + stateName;
    let title = "Click a link (a conflict) or a group in the network to see where it happened (or use Select all), or a state on the map to zoom into it.";
    let numbers = "";

    if ( selection !== null ) {
        if ( selection.type === "all" ) {
            title = "All conflicts" + where;
        } else if ( selection.type === "link" ) {
            title = shortName(selection.source) + " vs " + shortName(selection.target) + where;
        } else {
            title = shortName(selection.id) + " (all its conflicts" + where + ")";
        }
    } else if ( stateName !== null ) {
        title = "All conflicts in " + stateName;
    }

    if ( selection !== null || stateName !== null ) {
        if ( list.length === 0 ) {
            numbers = "No events with an exact place in " + formatYears([ startYear, endYear ]) + " for these types.";
        } else {
            numbers = formatNumber(d3.sum(list, d => d.deaths)) + " deaths · "
                + formatNumber(list.length) + " events · "
                + formatNumber(places.length) + " places · "
                + formatYears(d3.extent(list, d => d.year));
        }
    }

    d3.select("#captionTitle").text(title).classed("hint", selection === null && stateName === null);

    // the button stays pressed while everything is selected
    d3.select("#selectAll").attr("aria-pressed", selection !== null && selection.type === "all");
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
}


// ---------------------------------------------------------------- interaction

// the events in focus, in any year: those of the selected conflict or group (or all of them),
// of the checked types, inside the zoomed state if there is one
function getFocusEvents() {
    let list = getTypeEvents();

    return selection === null ? list : list.filter(inSelection);
}

// moves the slider to the years of the events in focus, so selecting a conflict or
// zooming into a state always shows the whole period it was active
function jumpToFocusYears() {
    let years = getFocusEvents().map(d => d.year);

    if ( years.length === 0 ) {
        updateAll();
        return;
    }

    stopPlay();
    singleYear = d3.min(years) === d3.max(years);
    d3.select("#singleYear").property("checked", singleYear);
    setYears(d3.min(years), d3.max(years));
}

function select(newSelection) {
    // clicking the selected link or group again clears the selection, like in View 1
    let same = selection !== null && newSelection !== null
        && selection.type === newSelection.type
        && (selection.key || selection.id) === (newSelection.key || newSelection.id);

    selection = same ? null : newSelection;

    // selecting everything keeps the years on the slider; one conflict or group moves it to its years
    if ( selection !== null && selection.type === "all" ) {
        updateAll();
    } else {
        jumpToFocusYears();
    }
}

// zooms into a state (or back to Brazil with null) and filters the network and the map to it;
// clicking the zoomed state again goes back, like in View 1
function selectState(stateCode) {
    selectedState = selectedState === stateCode ? null : stateCode;

    // zooming in starts with all the conflicts of the state on the map; a click in the
    // network then narrows it. Zooming out keeps the selection made inside the state
    if ( selectedState !== null ) {
        selection = null;
    }

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

// moves both handles, the dark fill between them and the label
function updateSliders() {
    let position = year => (year - minYear) / (maxYear - minYear);
    let p0 = position(startYear),
        p1 = position(endYear);

    d3.select("#startSlider").property("value", startYear);
    d3.select("#endSlider").property("value", endYear).style("display", singleYear ? "none" : null);

    // the centre of a 20px handle goes from 10px to (width - 10px)
    d3.select("#rangeFill")
        .style("display", singleYear ? "none" : null)
        .style("left", "calc(10px + (100% - 20px) * " + p0 + ")")
        .style("width", "calc((100% - 20px) * " + (p1 - p0) + ")");

    // when the handles meet at the end, the first one goes on top so it can still be dragged back
    d3.select("#startSlider").style("z-index", startYear === maxYear ? 2 : null);

    d3.select("#yearLabel").text(formatYears([ startYear, endYear ]));
    d3.select("#playButton").style("display", singleYear ? null : "none");
}

function stopPlay() {
    if ( playTimer !== null ) {
        playTimer.stop();
        playTimer = null;
        // back to whole years (only after playing: doing it on every call would undo
        // the user's drag before the slider is read)
        d3.select("#startSlider").attr("step", 1).property("value", startYear);
    }
    d3.select("#playButton").text("Play");
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

    d3.select("#playButton").text("Pause");
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

    d3.select("#minYear").text(minYear);
    d3.select("#maxYear").text(maxYear);

    d3.select("#singleYear").on("change", function() {
        stopPlay();
        singleYear = this.checked;

        if ( singleYear ) {
            setYears(startYear, startYear);
        } else {
            // back to a range: the years of what is in focus, or all the years
            let years = getFocusEvents().map(d => d.year);
            setYears(d3.min(years) || minYear, d3.max(years) || maxYear);
        }
    });

    d3.select("#playButton").on("click", togglePlay);
    d3.select("#zoomOut").on("click", () => selectState(null));
    d3.select("#selectAll").on("click", () => select({ type: "all" }));
    d3.selectAll("#typeFilter input").on("change", updateAll);
}

function setupVis() {
    [ minYear, maxYear ] = d3.extent(events, d => d.year);
    startYear = minYear;
    endYear = maxYear;

    drawNetwork();
    drawPlaceMap();
    setupControls();
    zoomMap();

    // starts with everything selected, in all the years
    select({ type: "all" });

    // the first layout is computed before it is shown, so the page does not open with
    // every group flying into place; later changes are animated
    simulation.stop();
    simulation.tick(300);
    paintNetwork();
    simulation.restart();
}
