#!/usr/bin/env python3
"""Build state presets plus the practical Greater Boston / MBTA core boundary."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

from shapely import make_valid
from shapely.geometry import mapping, shape
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "regions.geojson"
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


def main():
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


if __name__ == "__main__":
    main()
