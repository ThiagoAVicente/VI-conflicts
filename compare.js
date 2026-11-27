// Compare chart of View 2 (under the year slider): one line for each group picked in the list,
// with the deaths or the events over the years, added up or year by year. It follows the filters of
// the view (types of event, zoomed state) and marks the years chosen on the slider.
// Libraries: d3 v7 (global object d3), loaded in index.html.

// The eight categorical colours of the palette (checked for colour-blind readers), always in this
// order: a group keeps its colour while it is picked, and takes the first free one when it is added.
// The legend, the end labels and the tooltip say who is who, so the colour never works alone.
let SERIES_COLORS = [ "#257de0", "#f47230", "#00b894", "#f2a600", "#ee7fac", "#008a17", "#6a4ce2", "#ec4647" ];

let MAX_GROUPS = SERIES_COLORS.length,
    DIRECT_LABELS = 4,
    LABEL_LENGTH = 22,
    MARGIN = { top: 26, right: 150, bottom: 26, left: 54 };

let INK = "#1a1a19",
    SECONDARY = "#55554f",
    GRID = "#e6e5e1",
    BASELINE = "#c9c8c2",
    BAND = "#d8d7d2",
    SURFACE = "#fcfcfb";

// root: the element of the view; source: what the chart needs from the view (see setupVis in view2.js)
export function createCompare(root, source) {
    let panel = root.select(".compare"),
        frame = panel.select(".compareFrame");

    // group -> colour slot, in the order the groups were picked
    let chosen = new Map();

    let metric = "deaths",
        cumulative = true;

    let formatFull = d3.format(","),
        formatShort = d3.format("~s");

    // every group, from the one with most deaths; the civilians are not an armed group
    let deathsOfGroup = new Map();

    source.getAllEvents().forEach(d => {
        [ d.sideA, d.sideB ].forEach(name => deathsOfGroup.set(name, (deathsOfGroup.get(name) || 0) + d.deaths));
    });

    let groups = Array.from(deathsOfGroup.keys())
        .filter(name => name !== "Civilians")
        .sort((a, b) => d3.descending(deathsOfGroup.get(a), deathsOfGroup.get(b)));

    // what the chart was drawn with: when only the years of the slider change, only their mark is redrawn
    let chart = null,
        drawnKey = "";

    drawList();
    setupControls();
    new ResizeObserver(() => update()).observe(frame.node());


    // ---------------------------------------------------------------- the list of groups

    function firstFreeSlot() {
        let used = Array.from(chosen.values());

        return d3.range(MAX_GROUPS).find(slot => !used.includes(slot));
    }

    function drawList() {
        let items = panel.select(".groupList").selectAll("label")
            .data(groups)
            .join("label")
                .attr("class", "pickerItem");

        items.append("input")
            .attr("type", "checkbox")
            .on("change", function(e, name) {
                if ( this.checked ) {
                    chosen.set(name, firstFreeSlot());
                } else {
                    chosen.delete(name);
                }
                update();
                source.onPick(Array.from(chosen.keys()));
            });
        items.append("i").attr("class", "swatch");
        items.append("span").attr("class", "pickerName").text(name => source.shortName(name));
        items.append("span").attr("class", "pickerCount");
    }

    // the boxes follow the picked groups; with the maximum picked the others wait for a free place
    function updateList(totals) {
        let full = chosen.size >= MAX_GROUPS;

        panel.selectAll(".pickerItem").each(function(name) {
            let item = d3.select(this),
                on = chosen.has(name);

            item.classed("isOn", on);
            item.select("input").property("checked", on).property("disabled", full && !on);
            item.select(".swatch").style("background", on ? SERIES_COLORS[chosen.get(name)] : null);
            item.select(".pickerCount").text(formatFull(totals.get(name) || 0));
        });
    }

    function setupControls() {
        panel.select(".clearGroups").on("click", () => {
            chosen.clear();
            update();
            source.onPick([]);
        });

        panel.selectAll(".metricSwitch input").on("change", function() {
            metric = this.value;
            update();
        });
        panel.selectAll(".sumSwitch input").on("change", function() {
            cumulative = this.value === "added";
            update();
        });
    }


    // ---------------------------------------------------------------- the numbers

    // for each picked group the value of every year (added up or not), and the total of every group
    // (for the list) with the current filters
    function getData() {
        let [ first, last ] = source.getPeriod();
        let years = d3.range(first, last + 1);
        let perYear = new Map(Array.from(chosen.keys(), name => [ name, new Map() ]));
        let totals = new Map();

        // an event counts for both of its sides
        source.getEvents().forEach(d => {
            let value = metric === "deaths" ? d.deaths : 1;

            [ d.sideA, d.sideB ].forEach(name => {
                totals.set(name, (totals.get(name) || 0) + value);

                if ( perYear.has(name) ) {
                    perYear.get(name).set(d.year, (perYear.get(name).get(d.year) || 0) + value);
                }
            });
        });

        let series = Array.from(chosen, ([ name, slot ]) => {
            let sum = 0;

            return {
                name: name,
                color: SERIES_COLORS[slot],
                values: years.map(year => {
                    let value = perYear.get(name).get(year) || 0;

                    sum += value;
                    return { year: year, value: cumulative ? sum : value };
                })
            };
        });

        return { years, series, totals };
    }

    // ticks under 10,000 in full, above in short form (10k), one style for the whole axis
    function getFormat(ticks) {
        return d3.max(ticks) >= 10000 ? formatShort : formatFull;
    }

    function shorten(text) {
        return text.length > LABEL_LENGTH ? text.slice(0, LABEL_LENGTH - 1) + "…" : text;
    }


    // ---------------------------------------------------------------- draw

    function update() {
        let key = [ source.getDataKey(), metric, cumulative, frame.node().clientWidth, frame.node().clientHeight,
            Array.from(chosen).join(";") ].join("|");

        if ( chart !== null && key === drawnKey ) {
            drawYears();
            updateNote();
            return;
        }

        let data = getData();

        updateList(data.totals);
        updateLegend(data.series);

        drawChart(data);
        drawnKey = key;
        updateNote();
    }

    // names of the picked groups with a short line of their colour (with two or more groups)
    function updateLegend(series) {
        let items = panel.select(".compareLegend").text("").selectAll("span")
            .data(series.length >= 2 ? series : [])
            .join("span");

        items.append("i").attr("class", "lineKey").style("background", d => d.color);
        items.append("text").text(d => source.shortName(d.name));
    }

    function updateNote() {
        let range = source.getYears(),
            scope = source.getScope();

        panel.select(".compareNote").text(
            (cumulative ? "Added up from " + source.getPeriod()[0] + ". " : "Year by year. ")
            + ((!range.single && range.first === source.getPeriod()[0] && range.last === source.getPeriod()[1]) ? ""
                : range.single ? "The vertical line is the year of the slider. " : "The grey band is the years of the slider. ")
            + "An event counts for both of its sides."
            + (chosen.size >= MAX_GROUPS ? " At most " + MAX_GROUPS + " groups are compared (with Select all, the ones with most deaths)." : "")
            + (scope === "" ? "" : " Only the events in " + scope + "."));
    }

    function drawChart({ years, series }) {
        let width = frame.node().clientWidth,
            height = frame.node().clientHeight;

        frame.text("");
        chart = null;

        if ( width === 0 || height === 0 ) {
            return;
        }

        if ( series.length === 0 ) {
            frame.append("p").attr("class", "compareEmpty").text("Pick up to " + MAX_GROUPS + " groups in the list, or select them in the network, to compare them.");
            return;
        }

        let svg = frame.append("svg")
            .attr("width", width)
            .attr("height", height)
            .attr("role", "img")
            .attr("aria-label", "Line chart of the " + metric + " of " + series.map(d => source.shortName(d.name)).join(", ")
                + " by year; the same numbers are in the table view");

        let left = MARGIN.left,
            right = width - MARGIN.right,
            top = MARGIN.top,
            bottom = height - MARGIN.bottom;

        let x = d3.scaleLinear()
            .domain(d3.extent(years))
            .range([ left, right ]);

        let max = d3.max(series, s => d3.max(s.values, d => d.value)) || 0;
        let y = d3.scaleLinear().domain([ 0, max || 1 ]).nice(4).range([ bottom, top ]),
            ticks = y.ticks(4);

        let format = getFormat(ticks);

        // grid and axes: hairlines, the baseline a little darker
        svg.append("g").selectAll("line")
            .data(ticks)
            .join("line")
                .attr("x1", left)
                .attr("x2", right)
                .attr("y1", d => y(d))
                .attr("y2", d => y(d))
                .attr("stroke", d => d === 0 ? BASELINE : GRID)
                .attr("stroke-width", 1);

        svg.append("g").selectAll("text")
            .data(ticks)
            .join("text")
                .attr("x", left - 8)
                .attr("y", d => y(d))
                .attr("dy", "0.32em")
                .attr("text-anchor", "end")
                .attr("fill", SECONDARY)
                .attr("font-size", 12)
                .text(d => format(d));

        let yearTicks = d3.range(Math.ceil(years[0] / 5) * 5, d3.max(years) + 1, 5);

        svg.append("g").selectAll("text")
            .data(yearTicks)
            .join("text")
                .attr("x", d => x(d))
                .attr("y", bottom + 17)
                .attr("text-anchor", "middle")
                .attr("fill", SECONDARY)
                .attr("font-size", 12)
                .text(d => d);

        svg.append("text")
            .attr("x", 4)
            .attr("y", top - 12)
            .attr("text-anchor", "start")
            .attr("fill", SECONDARY)
            .attr("font-size", 12)
            .text(metric);

        chart = { mark: svg.append("g"), x: x, top: top, bottom: bottom };
        drawYears();

        // the lines, 2px, and a dot at the end of each one
        let line = d3.line()
            .x(d => x(d.year))
            .y(d => y(d.value));

        svg.append("g").selectAll("path")
            .data(series)
            .join("path")
                .attr("d", d => line(d.values))
                .attr("fill", "none")
                .attr("stroke", d => d.color)
                .attr("stroke-width", 2)
                .attr("stroke-linejoin", "round")
                .attr("stroke-linecap", "round");

        svg.append("g").selectAll("circle")
            .data(series)
            .join("circle")
                .attr("cx", d => x(d3.max(years)))
                .attr("cy", d => y(d.values[d.values.length - 1].value))
                .attr("r", 4)
                .attr("fill", d => d.color)
                .attr("stroke", SURFACE)
                .attr("stroke-width", 2);

        if ( series.length <= DIRECT_LABELS ) {
            drawEndLabels(svg, series, y, right);
        }

        drawHover(svg, series, x, y, { left, right, top, bottom });
    }

    // the years of the slider: a band for a range, a line for a single year
    function drawYears() {
        let { mark: svg, x, top, bottom } = chart,
            range = source.getYears(),
            [ first, last ] = source.getPeriod();

        svg.text("");

        // all the years chosen: nothing to mark
        if ( !range.single && range.first === first && range.last === last ) {
            return;
        }

        if ( range.single ) {
            svg.append("line")
                .attr("x1", x(range.first))
                .attr("x2", x(range.first))
                .attr("y1", top)
                .attr("y2", bottom)
                .attr("stroke", INK)
                .attr("stroke-width", 1.5)
                .attr("opacity", 0.55);
        } else {
            svg.append("rect")
                .attr("x", x(range.first))
                .attr("y", top)
                .attr("width", Math.max(2, x(range.last) - x(range.first)))
                .attr("height", bottom - top)
                .attr("fill", BAND)
                .attr("opacity", 0.45);
        }
    }

    // the name of each group at the end of its line; a label that would touch the one above is left
    // out (the legend and the tooltip still name it), the labels are never pushed away from their lines
    function drawEndLabels(svg, series, y, right) {
        let labels = series
            .map(d => ({ name: d.name, y: y(d.values[d.values.length - 1].value) }))
            .sort((a, b) => a.y - b.y);
        let lastY = -Infinity;

        labels = labels.filter(d => {
            if ( d.y - lastY < 14 ) {
                return false;
            }
            lastY = d.y;
            return true;
        });

        svg.append("g").selectAll("text")
            .data(labels)
            .join("text")
                .attr("x", right + 10)
                .attr("y", d => d.y)
                .attr("dy", "0.32em")
                .attr("fill", INK)
                .attr("font-size", 12)
                .text(d => shorten(source.shortName(d.name)));
    }

    // a vertical line follows the pointer to the nearest year, with a dot on each line and a tooltip
    // that lists every group of that year
    function drawHover(svg, series, x, y, box) {
        let cross = svg.append("line")
            .attr("y1", box.top)
            .attr("y2", box.bottom)
            .attr("stroke", INK)
            .attr("stroke-width", 1)
            .attr("opacity", 0);
        let dotLayer = svg.append("g");
        let tooltip = d3.select("#tooltip");

        function hide() {
            cross.attr("opacity", 0);
            dotLayer.text("");
            tooltip.style("display", "none");
        }

        svg.append("rect")
            .attr("x", box.left)
            .attr("y", box.top)
            .attr("width", box.right - box.left)
            .attr("height", box.bottom - box.top)
            .attr("fill", "transparent")
            .on("pointermove", e => {
                let [ pointerX ] = d3.pointer(e);
                let years = series[0].values.map(d => d.year);
                let year = Math.max(years[0], Math.min(d3.max(years), Math.round(x.invert(pointerX))));
                let rows = series
                    .map(d => ({ name: d.name, color: d.color, value: d.values.find(v => v.year === year).value }))
                    .sort((a, b) => d3.descending(a.value, b.value));

                cross.attr("x1", x(year)).attr("x2", x(year)).attr("opacity", 0.4);

                dotLayer.selectAll("circle")
                    .data(rows)
                    .join("circle")
                        .attr("cx", x(year))
                        .attr("cy", d => y(d.value))
                        .attr("r", 4)
                        .attr("fill", d => d.color)
                        .attr("stroke", SURFACE)
                        .attr("stroke-width", 2);

                // the names come from the data: always text, never html
                tooltip.text("").style("display", "block");
                tooltip.append("div").attr("class", "tipTitle").text(year + (cumulative ? ", added up" : ""));

                rows.forEach(d => {
                    let row = tooltip.append("div").attr("class", "tipRow");

                    row.append("i").attr("class", "tipKey").style("background", d.color);
                    row.append("strong").text(formatFull(d.value));
                    row.append("span").text(source.shortName(d.name));
                });

                // above the pointer (the chart is at the bottom of the page), and on the left of it near the right edge
                let tip = tooltip.node();
                let tipLeft = e.clientX + 14;

                if ( tipLeft + tip.offsetWidth > window.innerWidth - 8 ) {
                    tipLeft = e.clientX - tip.offsetWidth - 14;
                }
                tooltip.style("left", tipLeft + "px").style("top", Math.max(8, e.clientY - tip.offsetHeight - 12) + "px");
            })
            .on("pointerleave", hide);
    }

    // the picked groups are now these (the network selected them): the ones that stay keep their colour,
    // the groups that are not armed groups (the civilians) are not compared
    function setGroups(names, quiet) {
        let wanted = names.filter(name => groups.includes(name)).slice(0, MAX_GROUPS);

        Array.from(chosen.keys()).forEach(name => {
            if ( !wanted.includes(name) ) {
                chosen.delete(name);
            }
        });
        wanted.forEach(name => {
            if ( !chosen.has(name) ) {
                chosen.set(name, firstFreeSlot());
            }
        });

        // quiet: the caller updates the chart itself
        if ( !quiet ) {
            update();
        }
    }

    // the groups with most deaths in the events of the view (the ones the chart shows when everything is selected)
    function topGroups() {
        let deaths = new Map();

        source.getEvents().forEach(d => {
            [ d.sideA, d.sideB ].forEach(name => deaths.set(name, (deaths.get(name) || 0) + d.deaths));
        });
        return groups.filter(name => deaths.has(name))
            .sort((a, b) => d3.descending(deaths.get(a), deaths.get(b)))
            .slice(0, MAX_GROUPS);
    }

    return { update, setGroups, topGroups, canPick: name => groups.includes(name), maxGroups: MAX_GROUPS };
}
