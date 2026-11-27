# Conflicts in Brazil

Visual exploration of organised violence in Brazil (1993-2025), for Information Visualisation 2026/27, University of Aveiro.

One page with two views, switched with the tabs at the top (the year, filters and selection of each view are kept when you switch):

- **View 1** (`#map`): a map of Brazil coloured by the deaths or the events of each state, with a year slider (Single year, Compare two years, or the sum of a Range of years), a type-of-event filter and a side panel with the details of a state.
- **View 2** (`#network`): a force-directed network of the armed groups (links are conflicts, dotted links are attacks on civilians, size and width are deaths). Clicking a link or a group draws its events as dots on a map of Brazil (size is deaths, shade is the typical year) and moves the year range to the years it was active. It only uses events with an exact place (`where_prec` 1-3); the 62 records with only a state-level location are left out, with a note under the map.

## How to run

The page loads its data with `d3.csv` and `d3.json`, so it needs a local server (opening the file directly does not work):

```
python3 -m http.server
```

Then open http://localhost:8000/ (index.html). An internet connection is needed to load d3 from its CDN.

## Folders and files

- `index.html`, `style.css`: the page with both views, and their styles.
- `main.js`: loads the data once, starts the two views and switches between them.
- `view1.js`, `view2.js`: the code of each view (ES modules).
- `data/brazil.csv`: the UCDP GED events, Brazil only.
- `data/states.json`: simplified state borders.
- `scripts/prepare_states.py`: creates `states.json` from the original borders (needs `shapely`).

To recreate it: `python3 scripts/prepare_states.py br_states.json data/states.json`

## Data and credits

- Events: UCDP Georeferenced Event Dataset (GED) Global, version 26.1, filtered to Brazil. https://ucdp.uu.se/downloads/
- State borders: https://github.com/giuliano-macedo/geodata-br-states (MIT licence), simplified by `prepare_states.py`.
- d3.js v7, loaded from https://d3js.org/d3.v7.min.js
- Code style and the map approach (GeoJSON, `d3.geoPath`, `d3.rollup`) follow the D3 lab lessons of the course.
- The drag of the network nodes follows the usual `d3.drag` + `d3.forceSimulation` pattern from the d3-force documentation.

## Use of AI

Claude (Anthropic) was used to help write the code of Views 1 and 2 and the data preparation script. The group is responsible for the content.
