// Shared by the two views: a click on the track of the year slider moves the nearest handle there.
// (With two handles the inputs are on top of each other and only the handles take the mouse, so
// a click on the track lands on the track itself; with one handle the input already handles it.)

export function enableTrackClick(range, minYear, maxYear) {
    range.addEventListener("pointerdown", e => {
        // a press on a handle is dragged by the browser as usual
        if ( e.target.tagName === "INPUT" ) {
            return;
        }

        // the centre of a 20px handle goes from 10px to (width - 10px)
        let box = range.getBoundingClientRect();
        let year = Math.round(minYear + (e.clientX - box.left - 10) / (box.width - 20) * (maxYear - minYear));

        year = Math.max(minYear, Math.min(maxYear, year));

        // the handles in use: the ones that are not hidden
        let handles = Array.from(range.querySelectorAll("input"))
            .filter(d => !d.hidden && getComputedStyle(d).display !== "none");

        // the nearest handle; if two are at the same distance (they are on the same year) the
        // one on the side of the click, so both can be pulled apart
        let nearest = handles.reduce((best, d) => {
            let distance = Math.abs(+d.value - year),
                bestDistance = Math.abs(+best.value - year);

            return distance < bestDistance || (distance === bestDistance && year > +d.value) ? d : best;
        });

        // the view listens to "input" events, as when the handle is dragged
        nearest.value = year;
        nearest.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
