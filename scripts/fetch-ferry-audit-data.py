#!/usr/bin/env python3
"""Fetch Census hydrography tiles touching the generated ferry corridors."""

from __future__ import annotations

import argparse
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROUTES = ROOT / "data" / "regional-routes.geojson"
DEFAULT_OUTPUT = ROOT / ".codex-research" / "water-audit" / "tigerweb-hydro-ne.geojson"
QUERY_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Hydro/MapServer/1/query"
CELL = 0.25
CORRIDOR_BUFFER = 0.025


def ferry_paths():
    collection = json.loads(ROUTES.read_text(encoding="utf-8"))
    paths = []
    for feature in collection.get("features", []):
        if feature.get("properties", {}).get("group") != "ferry":
            continue
        geometry = feature.get("geometry", {})
        if geometry.get("type") not in {"LineString", "MultiLineString"}:
            continue
        geometry_paths = geometry.get("coordinates", [])
        if geometry.get("type") == "LineString":
            geometry_paths = [geometry_paths]
        paths.extend(path for path in geometry_paths if len(path) >= 2)
    if not paths:
        raise RuntimeError("Generated route data contains no ferry lines")
    return paths


def corridor_tiles(paths):
    indexes = set()
    for path in paths:
        for start, end in zip(path, path[1:]):
            minx = min(start[0], end[0]) - CORRIDOR_BUFFER
            miny = min(start[1], end[1]) - CORRIDOR_BUFFER
            maxx = max(start[0], end[0]) + CORRIDOR_BUFFER
            maxy = max(start[1], end[1]) + CORRIDOR_BUFFER
            for x_index in range(math.floor(minx / CELL), math.ceil(maxx / CELL)):
                for y_index in range(math.floor(miny / CELL), math.ceil(maxy / CELL)):
                    indexes.add((x_index, y_index))
    for x_index, y_index in sorted(indexes):
        yield (
            round(x_index * CELL, 6),
            round(y_index * CELL, 6),
            round((x_index + 1) * CELL, 6),
            round((y_index + 1) * CELL, 6),
        )


def fetch_tile(bounds):
    body = urllib.parse.urlencode({
        "f": "geojson",
        "where": "1=1",
        "geometry": ",".join(str(value) for value in bounds),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "OBJECTID",
        "returnGeometry": "true",
        "geometryPrecision": "6",
        "resultRecordCount": "100000",
    }).encode("ascii")
    request = urllib.request.Request(
        QUERY_URL,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "New England in Motion ferry geometry auditor",
        },
    )
    last_error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                result = json.load(response)
            if result.get("error"):
                raise RuntimeError(result["error"])
            if result.get("exceededTransferLimit"):
                raise RuntimeError(f"Hydro tile {bounds} exceeded the service limit")
            return result.get("features", [])
        except Exception as error:
            last_error = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Unable to fetch hydro tile {bounds}: {last_error}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    tiles = list(corridor_tiles(ferry_paths()))
    print(f"Fetching {len(tiles)} ferry-corridor hydrography tiles", flush=True)
    features_by_id = {}
    for index, bounds in enumerate(tiles, 1):
        print(f"[{index:03}/{len(tiles)}] requesting {bounds}", flush=True)
        features = fetch_tile(bounds)
        for feature in features:
            identifier = feature.get("properties", {}).get("OBJECTID") or feature.get("id")
            if identifier is None:
                identifier = json.dumps(feature.get("geometry"), sort_keys=True)
            features_by_id[identifier] = feature
        print(f"          received {len(features):,} polygons", flush=True)
        time.sleep(0.05)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({
            "type": "FeatureCollection",
            "metadata": {
                "source": "U.S. Census Bureau TIGERweb 2025 Areal Hydrography",
                "queryLayer": QUERY_URL.rsplit("/query", 1)[0],
                "corridorBufferDegrees": CORRIDOR_BUFFER,
                "tileDegrees": CELL,
                "tileCount": len(tiles),
            },
            "features": list(features_by_id.values()),
        }, separators=(",", ":")),
        encoding="utf-8",
        newline="\n",
    )
    print(f"Wrote {len(features_by_id):,} unique hydro polygons to {args.output}")


if __name__ == "__main__":
    main()
