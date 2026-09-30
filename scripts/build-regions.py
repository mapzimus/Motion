#!/usr/bin/env python3
"""Build state presets plus the practical Greater Boston / MBTA core boundary."""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

from shapely import make_valid
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "regions.geojson"
MARINE_OUTPUT = ROOT / "data" / "regions-marine.geojson"
TIGERWEB_QUERY = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/1/query"
)

# County subdivisions are the authoritative municipal boundaries in
# Massachusetts. Braintree and Winthrop use Census BASENAME values ending in
# "Town" even though their public-facing names do not.
CORE_BASENAMES = {
    "Arlington": "Arlington",
    "Belmont": "Belmont",
    "Boston": "Boston",
    "Braintree Town": "Braintree",
    "Brookline": "Brookline",
    "Cambridge": "Cambridge",
    "Chelsea": "Chelsea",
    "Everett": "Everett",
    "Malden": "Malden",
    "Medford": "Medford",
    "Milton": "Milton",
    "Newton": "Newton",
    "Quincy": "Quincy",
    "Revere": "Revere",
    "Somerville": "Somerville",
    "Watertown": "Watertown",
    "Winthrop Town": "Winthrop",
}


def fetch_core():
    quoted_names = ",".join(f"'{name}'" for name in CORE_BASENAMES)
    params = urllib.parse.urlencode({
        "f": "geojson",
        "where": f"STATE='25' AND BASENAME IN ({quoted_names})",
        "outFields": "GEOID,NAME,BASENAME,STATE",
        "returnGeometry": "true",
        "outSR": "4326",
        "geometryPrecision": "6",
        "orderByFields": "BASENAME",
    })
    request = urllib.request.Request(
        f"{TIGERWEB_QUERY}?{params}",
        headers={"User-Agent": "New England in Motion boundary builder"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        collection = json.load(response)
    found = {feature["properties"]["BASENAME"] for feature in collection.get("features", [])}
    missing = sorted(set(CORE_BASENAMES) - found)
    unexpected = sorted(found - set(CORE_BASENAMES))
    if missing or unexpected or len(collection.get("features", [])) != len(CORE_BASENAMES):
        raise RuntimeError(f"Greater Boston boundary mismatch; missing={missing}, unexpected={unexpected}")
    geometry = unary_union([
        make_valid(shape(feature["geometry"]))
        for feature in collection["features"]
    ]).simplify(0.00008, preserve_topology=True)
    return {
        "type": "Feature",
        "properties": {
            "key": "boston",
            "name": "Greater Boston / MBTA core",
            "geoid": "mbta-core-17",
            "members": sorted(CORE_BASENAMES.values()),
            "definition": "Boston plus 16 adjacent inner-core municipalities",
            "sourceUrl": "https://tigerweb.geo.census.gov/tigerweb/",
        },
        "geometry": mapping(geometry),
    }


# --- Marine (vessel) geometry -------------------------------------------------
# Vessels sit on the water, just past the generalized land/state boundary, so
# the vessel layer filters against each region grown by a coastal buffer.
# About 0.2 degrees (~20 km, roughly the 12 nm territorial sea) for states and
# New England, and a tighter 0.06 degrees for the MBTA core. Everything is
# clipped to the New England AIS box the gateway subscribes to.
STATE_KEYS = ("ct", "ma", "me", "nh", "ri", "vt")
MARINE_BUFFER_DEG = 0.2
MARINE_BUFFER_OVERRIDES = {"boston": 0.06}
MARINE_CLIP = box(-74.0, 40.8, -66.0, 47.7)  # AIS [[40.8,-74.0],[47.7,-66.0]]
MARINE_SIMPLIFY_DEG = 0.004


def _round_coords(value, places=4):
    if isinstance(value, (list, tuple)):
        if value and isinstance(value[0], (int, float)):
            return [round(value[0], places), round(value[1], places)]
        return [_round_coords(child, places) for child in value]
    return value


def build_marine(regions_fc):
    """Return a FeatureCollection of buffered, clipped region geometry.

    Takes the land/state region collection (data/regions.geojson) and returns
    one feature per region key, plus a 'new-england' feature that is the union
    of the six buffered states. Self-contained so the regions build can call
    it for any set of regions.
    """
    features = []
    buffered_states = []
    for feature in regions_fc.get("features", []):
        key = feature.get("properties", {}).get("key")
        if not key:
            continue
        distance = MARINE_BUFFER_OVERRIDES.get(key, MARINE_BUFFER_DEG)
        geometry = make_valid(shape(feature["geometry"])).buffer(distance, quad_segs=4)
        geometry = geometry.intersection(MARINE_CLIP)
        if key in STATE_KEYS:
            buffered_states.append(geometry)
        features.append((key, distance, geometry))
    if len(buffered_states) == len(STATE_KEYS):
        features.append(("new-england", MARINE_BUFFER_DEG, unary_union(buffered_states)))
    out = []
    for key, distance, geometry in features:
        geometry = geometry.simplify(MARINE_SIMPLIFY_DEG, preserve_topology=True)
        geojson = mapping(geometry)
        out.append({
            "type": "Feature",
            "properties": {"key": key, "bufferDeg": distance},
            "geometry": {"type": geojson["type"], "coordinates": _round_coords(geojson["coordinates"])},
        })
    return {
        "type": "FeatureCollection",
        "metadata": {
            "source": "data/regions.geojson grown by a coastal buffer for the vessel layer",
            "clip": [[40.8, -74.0], [47.7, -66.0]],
        },
        "features": out,
    }


def write_marine(regions_fc):
    collection = build_marine(regions_fc)
    text = json.dumps(collection, separators=(",", ":")) + "\n"
    MARINE_OUTPUT.write_text(text, encoding="utf-8", newline="\n")
    size_kb = len(text.encode("utf-8")) / 1024
    if size_kb > 300:
        raise RuntimeError(f"{MARINE_OUTPUT.name} is {size_kb:.0f} KB; raise MARINE_SIMPLIFY_DEG")
    print(f"Wrote {len(collection['features'])} marine regions ({size_kb:.0f} KB) to {MARINE_OUTPUT}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--marine-only",
        action="store_true",
        help="Read the existing data/regions.geojson and only rebuild data/regions-marine.geojson",
    )
    args = parser.parse_args()
    if args.marine_only:
        write_marine(json.loads(OUTPUT.read_text(encoding="utf-8")))
        return
    existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
    states = [
        feature for feature in existing.get("features", [])
        if feature.get("properties", {}).get("key") in {"ct", "ma", "me", "nh", "ri", "vt"}
    ]
    if len(states) != 6:
        raise RuntimeError("Existing region file must contain all six New England state boundaries")
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "U.S. Census Bureau TIGERweb 2025",
            "greaterBostonDefinition": "Practical 17-municipality MBTA inner core",
        },
        "features": [*states, fetch_core()],
    }
    OUTPUT.write_text(
        json.dumps(collection, separators=(",", ":")) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"Wrote {len(states)} states and {len(CORE_BASENAMES)} Greater Boston municipalities to {OUTPUT}")
    write_marine(collection)


if __name__ == "__main__":
    main()
