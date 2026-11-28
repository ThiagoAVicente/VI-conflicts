// View 2: adjacency matrix of the armed groups, above the graph builder and the map.
// Rows and columns are all the groups, the ones with most deaths first; the colour of a cell is the deaths of the conflicts
// between the two groups in the years of the slider. A click on a cell adds both groups to the graph.
// Libraries: d3 v7 (global object d3), loaded in index.html.

// every group has a row and a column: the cells are small
let CELL = 19,
    LABEL_LEFT = 130,
    LABEL_TOP = 150,
    EMPTY_COLOR = "#efeeea",
    INK = "#1a1a19",
    LABEL_RIGHT = 110;

// the same blues as the deaths in View 1: light for few deaths, dark for many
let CELL_LIGHT = "#cfe1f8",
    CELL_DARK = "#0d366b";

// source: what View 2 knows
//   getTypeEvents()     the events of the checked types (in the zoomed state), in any year
//   getVisibleEvents()  the same, inside the years of the slider
//   getGraphGroups()    the groups in the graph
//   onPick(a, b)        a cell was clicked: both groups go to the graph
//   shortName(name), formatNumber, showTooltip(e, text), hideTooltip()
export function createMatrix(container, source) {
    let svg = container.append("svg").attr("role", "img");

    function update() {
        // the groups with most deaths in any year, so the rows do not change while the slider moves
        let deaths = new Map();

        source.getTypeEvents().forEach(d => {
            [ d.sideA, d.sideB ].forEach(name => deaths.set(name, (deaths.get(name) || 0) + d.deaths));
        });

        let names = Array.from(deaths.keys()).sort((a, b) => d3.descending(deaths.get(a), deaths.get(b)) || d3.ascending(a, b)),
            index = new Map(names.map((name, i) => [ name, i ]));

        let indexOf = name => index.get(name);

        // the numbers of every pair of rows (the conflict has no direction: both cells get it)
        let cells = new Map();

        source.getVisibleEvents().forEach(d => {
            let a = indexOf(d.sideA),
                b = indexOf(d.sideB);

            [ [ a, b ], [ b, a ] ].forEach(([ row, column ], i) => {
                // a group with itself is one cell, not two
                if ( i === 1 && a === b ) {
                    return;
                }
                let key = row + "," + column,
                    cell = cells.get(key) || { row, column, deaths: 0, events: 0 };

                cell.deaths += d.deaths;
                cell.events += 1;
                cells.set(key, cell);
            });
        });

        let max = d3.max(Array.from(cells.values()), d => d.deaths) || 1;
        let color = d3.scaleSqrt().domain([ 0, max ]).range([ CELL_LIGHT, CELL_DARK ]).interpolate(d3.interpolateRgb);

        let size = names.length * CELL,
            width = LABEL_LEFT + size + LABEL_RIGHT,
            height = LABEL_TOP + size + 8;

        svg.text("")
            .attr("viewBox", [ 0, 0, width, height ])
            .attr("width", width)
            .attr("height", height)
            .attr("aria-label", "Matrix of the conflicts between the " + names.length + " groups with most deaths; the colour is the deaths");

        let inGraph = new Set(source.getGraphGroups());
        let label = name => source.shortName(name);
        let graphLabel = name => inGraph.has(name);

        // the names of the groups: rows on the left, columns above (turned)
        svg.append("g").selectAll("text")
            .data(names)
            .join("text")
                .attr("x", LABEL_LEFT - 6)
                .attr("y", (d, i) => LABEL_TOP + i * CELL + CELL / 2)
                .attr("dy", "0.32em")
                .attr("text-anchor", "end")
                .attr("class", d => "matrixName" + (graphLabel(d) ? " inGraph" : ""))
                .text(label);

        svg.append("g").selectAll("text")
            .data(names)
            .join("text")
                .attr("transform", (d, i) => "translate(" + (LABEL_LEFT + i * CELL + CELL / 2) + "," + (LABEL_TOP - 6) + ") rotate(-55)")
                .attr("text-anchor", "start")
                .attr("class", d => "matrixName" + (graphLabel(d) ? " inGraph" : ""))
                .text(label);

        // every cell of the grid; the diagonal (a group with itself) is left empty
        let grid = d3.cross(d3.range(names.length), d3.range(names.length))
            .map(([ row, column ]) => cells.get(row + "," + column) || { row, column, deaths: 0, events: 0 });

        svg.append("g").selectAll("rect")
            .data(grid)
            .join("rect")
                .attr("x", d => LABEL_LEFT + d.column * CELL + 1)
                .attr("y", d => LABEL_TOP + d.row * CELL + 1)
                .attr("width", CELL - 2)
                .attr("height", CELL - 2)
                .attr("rx", 2)
                .attr("fill", d => d.events > 0 ? color(d.deaths) : EMPTY_COLOR)
                // both groups of the cell are in the graph
                .attr("stroke", d => d.row !== d.column && inGraph.has(names[d.row]) && inGraph.has(names[d.column]) ? INK : "none")
                .attr("stroke-width", 1.5)
                .style("cursor", d => d.events > 0 ? "pointer" : "default")
                .on("mousemove", (e, d) => {
                    let a = label(names[d.row]),
                        b = label(names[d.column]);

                    source.showTooltip(e, d.events === 0
                        ? a + " and " + b + ": no conflict in these years"
                        : a + (d.row === d.column ? " inside" : " vs " + b) + ": " + source.formatNumber(d.deaths) + " deaths, "
                            + source.formatNumber(d.events) + " events");
                })
                .on("mouseout", source.hideTooltip)
                .on("click", (e, d) => {
                    if ( d.events > 0 ) {
                        source.onPick(names[d.row], names[d.column]);
                    }
                });

        drawLegend(max, color);
    }

    // the colour ramp, with the deaths of the darkest cell
    function drawLegend(max, color) {
        let legend = d3.select(container.node().parentNode).select(".matrixLegend");

        legend.select(".matrixRamp").style("background", "linear-gradient(to right, "
            + d3.range(11).map(i => color(max * (i / 10) * (i / 10))).join(", ") + ")");
        legend.select(".matrixMax").text(source.formatNumber(max) + " deaths");
    }

    return { update };
}
