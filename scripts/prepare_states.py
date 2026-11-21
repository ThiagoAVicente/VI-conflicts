"""Creates data/states.json, the simplified state borders used by the map.

Usage: python3 prepare_states.py br_states.json data/states.json

br_states.json comes from github.com/giuliano-macedo/geodata-br-states (MIT), file geojson/br_states.json.
Needs: pip install shapely
"""
import json
import sys

from shapely.geometry import MultiPolygon, mapping, shape
from shapely.geometry.polygon import orient

source_file, output_file = sys.argv[1], sys.argv[2]

with open(source_file) as f:
    states = json.load(f)


def round_coords(value):
    """Rounds every coordinate to 2 decimals (about 1 km)."""
    if isinstance(value, (list, tuple)):
        return [round_coords(v) for v in value]
    return round(value, 2)


features = []
for feature in states["features"]:
    # simplify the borders so the page stays light (5.6 MB -> about 70 KB)
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

    geometry = mapping(geometry)
    geometry["coordinates"] = round_coords(geometry["coordinates"])

    # id = state code (CE, BA, ...), name = the name used by UCDP without the word "state"
    features.append({
        "type": "Feature",
        "id": feature["properties"]["SIGLA"],
        "properties": {"name": feature["properties"]["Estado"]},
        "geometry": geometry,
    })

with open(output_file, "w") as f:
    json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))
print(len(features), "states written")
