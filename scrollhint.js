// Shared by the two views: a "Scroll for more" button at the bottom of the window while there is more of
// the page below, so nobody misses that the view scrolls. It goes away at the end of the page, and a click
// scrolls down one screen.
// Libraries: d3 v7 (global object d3), loaded in index.html.

let END_GAP = 40;

// view: the element of the view that scrolls (see #view1 and #view2 in index.html)
export function createScrollHint(view) {
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let hint = d3.select("body").append("button")
        .attr("type", "button")
        .attr("class", "scrollHint")
        .attr("aria-label", "Scroll down: there is more below")
        .property("hidden", true);

    hint.append("span").text("Scroll for more");
    hint.append("svg")
        .attr("width", 14).attr("height", 14).attr("viewBox", "0 0 14 14")
        .attr("aria-hidden", "true")
        .append("path")
            .attr("d", "M2 4.5 L7 9.5 L12 4.5")
            .attr("fill", "none")
            .attr("stroke", "currentColor")
            .attr("stroke-width", 2)
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round");

    function update() {
        let moreBelow = !view.hidden && view.scrollTop + view.clientHeight < view.scrollHeight - END_GAP;

        hint.property("hidden", !moreBelow);
    }

    hint.on("click", () => view.scrollBy({ top: view.clientHeight * 0.8, behavior: reducedMotion ? "auto" : "smooth" }));

    view.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    // the page grows and shrinks (a comparison appears, the graph fills up) and the view is shown and hidden
    new ResizeObserver(update).observe(view);
    new MutationObserver(update).observe(view, { attributes: true, attributeFilter: [ "hidden" ] });
    Array.from(view.children).forEach(child => new ResizeObserver(update).observe(child));

    update();
    return { update };
}
