// Entry point: loads the data once, starts the two views and switches between them
// with the tabs of the navbar (index.html#map and index.html#network).
// Libraries: d3 v7 (global object d3), loaded in index.html.

import { startView1, stopPlay as stopPlay1 } from "./view1.js";
import { startView2, stopPlay as stopPlay2, showConflict } from "./view2.js";

let VIEWS = [
    { hash: "#map", id: "view1", stopPlay: stopPlay1 },
    { hash: "#network", id: "view2", stopPlay: stopPlay2 }
];

let loaded = false;

// shows the view of the address (the map by default) and hides the other one
function showView() {
    let current = VIEWS.find(d => d.hash === location.hash) || VIEWS[0];

    VIEWS.forEach(d => {
        d3.select("#" + d.id).property("hidden", d !== current);

        // a view that is not on screen stops playing the years
        if ( loaded && d !== current ) {
            d.stopPlay();
        }
    });

    d3.selectAll(".navbar a").attr("aria-current", function() {
        return this.getAttribute("href") === current.hash ? "page" : null;
    });
}

showView();
window.addEventListener("hashchange", showView);

// a conflict clicked in View 1 opens in View 2
window.addEventListener("openconflict", e => {
    location.hash = "#network";
    showView();
    showConflict(e.detail.conflict, e.detail.first, e.detail.last, e.detail.types);
});

Promise.all([ d3.json("data/states.json"), d3.csv("data/brazil.csv") ])
    .then(([ geo, rows ]) => {
        startView1(geo, rows);
        startView2(geo, rows);
        loaded = true;
    })
    .catch(err => {
        console.log(err);
        d3.select("#view1 #map").text("Could not load the data. Start a local server in this folder (python3 -m http.server) and open http://localhost:8000/");
    });
