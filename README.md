# Conflicts in Brazil

Visual exploration of organised violence in Brazil (1993-2025), for Information Visualisation 2026/27, University of Aveiro.

Only View 1 is built so far: a map of Brazil coloured by the deaths in each state, with a year slider, a type-of-event filter and a side panel with the details of a state.

## How to run

The page loads its data with `d3.csv` and `d3.json`, so it needs a local server (opening the file directly does not work):

```
python3 -m http.server
```

Then open http://localhost:8000/view1.html. An internet connection is needed to load d3 from its CDN.

## Folders and files

- `view1.html`, `view1.js`, `style.css`: the view.
- `data/brazil.csv`: the UCDP GED events, Brazil only.
- `data/states.json`: simplified state borders.
- `scripts/prepare_states.py`: creates `states.json` from the original borders (needs `shapely`).

To recreate it: `python3 scripts/prepare_states.py br_states.json data/states.json`

## Data and credits

- Events: UCDP Georeferenced Event Dataset (GED) Global, version 26.1, filtered to Brazil. https://ucdp.uu.se/downloads/
- State borders: https://github.com/giuliano-macedo/geodata-br-states (MIT licence), simplified by `prepare_states.py`.
- d3.js v7, loaded from https://d3js.org/d3.v7.min.js
- Code style and the map approach (GeoJSON, `d3.geoPath`, `d3.rollup`) follow the D3 lab lessons of the course.

## Use of AI

Claude (Anthropic) was used to help write the code of View 1 and the data preparation script. The group is responsible for the content.
