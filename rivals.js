// View 2: who a group fought. Pick a group and the groups it fought are listed, with the most deaths
// first, with a bar for the deaths of the conflicts between them in the years of the slider.
// A click on a rival adds both groups to the graph.
// Libraries: d3 v7 (global object d3), loaded in index.html.

let BAR_COLOR = "#256abf",
    BAR_IN_GRAPH = "#0d366b";

// source: what View 2 knows
//   getTypeEvents()     the events of the checked types (in the zoomed state), in any year
//   getVisibleEvents()  the same, inside the years of the slider
//   getGraphGroups()    the groups in the graph
//   onPick(a, b)        a rival was clicked: both groups go to the graph
//   onHover(name)       the pointer is on a rival (null when it leaves): the group is highlighted
//   shortName(name), formatNumber
export function createRivals(root, source) {
    let section = root.select(".rivalsArea"),
        select = section.select(".rivalGroup"),
        list = section.select(".rivalList"),
        note = section.select(".rivalNote"),
        group = "",
        listedGroups = "";

    // a group chosen in the box: the page goes down so its list is on screen
    select.on("change", function() {
        group = this.value;
        update();

        if ( group !== "" ) {
            section.node().scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                block: "start"
            });
        }
    });

    // the group whose rivals are shown (the graph sets it to the last group added)
    function setGroup(name) {
        group = name;
        update();
    }

    // the options: the groups with events, the ones with most events first (only drawn again when they change)
    function drawOptions() {
        let counts = new Map();

        source.getTypeEvents().forEach(d => {
            [ d.sideA, d.sideB ].forEach(name => counts.set(name, (counts.get(name) || 0) + 1));
        });

        let names = Array.from(counts.keys()).sort((a, b) => d3.descending(counts.get(a), counts.get(b)) || d3.ascending(a, b)),
            key = names.join("|");

        if ( key !== listedGroups ) {
            listedGroups = key;
            select.selectAll("option")
                .data([ "" ].concat(names))
                .join("option")
                    .attr("value", d => d)
                    .text(d => d === "" ? "Choose a group" : source.shortName(d) + " (" + source.formatNumber(counts.get(d)) + " events)");
        }

        // a group that has no events with these filters cannot stay chosen
        if ( !names.includes(group) ) {
            group = "";
        }
        select.property("value", group);
    }

    function update() {
        drawOptions();

        let rows = [];

        if ( group !== "" ) {
            let byRival = d3.rollups(
                source.getVisibleEvents().filter(d => d.sideA === group || d.sideB === group),
                events => ({ deaths: d3.sum(events, d => d.deaths), events: events.length }),
                d => d.sideA === group ? d.sideB : d.sideA);

            rows = byRival.map(([ name, value ]) => ({ name, deaths: value.deaths, events: value.events }))
                .sort((a, b) => d3.descending(a.deaths, b.deaths) || d3.descending(a.events, b.events) || d3.ascending(a.name, b.name));
        }

        let max = d3.max(rows, d => d.deaths) || 1,
            inGraph = new Set(source.getGraphGroups());

        note.text(group === "" ? "Choose a group to see the groups it fought."
            : rows.length === 0 ? source.shortName(group) + " has no conflicts in these years."
            : source.shortName(group) + " fought " + rows.length + (rows.length === 1 ? " group" : " groups")
                + " in these years. Click one to add both to the graph.");

        let items = list.selectAll("button.rival")
            .data(rows, d => d.name)
            .join(enter => {
                let item = enter.append("button").attr("type", "button").attr("class", "rival");

                item.append("span").attr("class", "rivalName");
                item.append("span").attr("class", "rivalBar").append("i");
                item.append("span").attr("class", "rivalValue");
                return item;
            })
            .order()
            .on("click", (e, d) => source.onPick(group, d.name))
            .on("mouseenter", (e, d) => source.onHover(d.name))
            .on("mouseleave", () => source.onHover(null));

        items.classed("inGraph", d => inGraph.has(d.name));
        items.select(".rivalName").text(d => source.shortName(d.name));
        items.select(".rivalBar i")
            .style("width", d => Math.max(2, d.deaths / max * 100) + "%")
            .style("background", d => inGraph.has(d.name) ? BAR_IN_GRAPH : BAR_COLOR);
        items.select(".rivalValue").text(d => source.formatNumber(d.deaths) + " deaths · " + source.formatNumber(d.events) + " events");
        items.attr("aria-label", d => source.shortName(group) + " vs " + source.shortName(d.name) + ": "
            + source.formatNumber(d.deaths) + " deaths, " + source.formatNumber(d.events) + " events. Add both to the graph");
    }

    return { update, setGroup };
}
