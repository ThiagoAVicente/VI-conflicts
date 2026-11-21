"""Prepares the small data files used by the views.

Usage: python3 prepare_data.py brazil.csv br_states.json data/

Reads:
  brazil.csv      UCDP GED events, Brazil only (see README for the source)
  br_states.json  state borders, from github.com/giuliano-macedo/geodata-br-states (MIT)
Writes:
  data/events.csv    one line per event, only the columns the views need
  data/states.json   simplified GeoJSON, one feature per state (id = state code)
"""
import json
import sys

import pandas as pd
from shapely.geometry import MultiPolygon, mapping, shape
from shapely.geometry.polygon import orient

events_file, states_file, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]

# ---- states: keep name + code, simplify the borders so the page stays light
with open(states_file) as f:
    states = json.load(f)

features = []
for feature in states["features"]:
    geometry = shape(feature["geometry"]).simplify(0.03)
    # d3 wants outer rings clockwise (the opposite of the GeoJSON standard),
    # with the other order a state is drawn as "the whole world except this state"
    if geometry.geom_type == "Polygon":
        geometry = orient(geometry, sign=-1.0)
    else:
        # tiny islands are dropped: after rounding they turn into broken rings,
        # and a single broken ring makes d3 fill the whole map
        big = [polygon for polygon in geometry.geoms if polygon.area > 0.002]
        geometry = MultiPolygon([orient(polygon, sign=-1.0) for polygon in big])
    features.append({
        "type": "Feature",
        "id": feature["properties"]["SIGLA"],
        "properties": {"name": feature["properties"]["Estado"]},
        "geometry": mapping(geometry),
    })


def round_coords(value):
    """Rounds every coordinate to 2 decimals (about 1 km)."""
    if isinstance(value, (list, tuple)):
        return [round_coords(v) for v in value]
    return round(value, 2)


for feature in features:
    feature["geometry"]["coordinates"] = round_coords(feature["geometry"]["coordinates"])

with open(out_dir + "/states.json", "w") as f:
    json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))

# ---- events: the state name in UCDP is "Ceará state", the code comes from the borders file
code_by_name = {f["properties"]["name"]: f["id"] for f in features}
events = pd.read_csv(events_file, low_memory=False)
events["state"] = events["adm_1"].str.replace(" state", "", regex=False).map(code_by_name)
missing = events[events["state"].isna()]["adm_1"].unique()
if len(missing) > 0:
    print("states without a match:", missing)

events["type"] = events["type_of_violence"].map({2: "faction", 3: "civilians"})
events["conflict"] = events["dyad_name"].str.replace(" - ", " vs ", regex=False)
slim = events[["year", "state", "type", "conflict", "best"]].rename(columns={"best": "deaths"})
slim.to_csv(out_dir + "/events.csv", index=False)
print(len(slim), "events written")
