#!/usr/bin/env python3
"""Fetch the OpenStreetMap water model used to build and audit ferry geometry.

Three local files are written to ``.codex-research/water-audit/`` (gitignored):

``osm-land-ne.wkb.json``
    OpenStreetMap coastline land polygons (osmdata.openstreetmap.de
    ``land-polygons-split-4326``), clipped to the New England bounding box.
``osm-inland-water-ne.wkb.json``
    Overpass ``natural=water`` / ``waterway=riverbank`` / ``waterway=dock``
    polygons touching ferry corridors. The coastline treats lakes and rivers
    behind a coastline closure (hurricane barriers, river mouths) as land, so
    these polygons are subtracted from the land polygons.
``osm-ferry-ways.json``
    Raw Overpass ``route=ferry`` ways in the New England ferry bbox. These are
    matched to our terminals as a geometry source.

The ~925 MB land-polygon zip is downloaded once and reused; pass
``--refresh-land`` to download it again.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

OUTPUT_DIR = ROOT / ".codex-research" / "water-audit"
LAND_URL = "https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip"
LAND_ZIP = OUTPUT_DIR / "land-polygons-split-4326.zip"
LAND_OUTPUT = OUTPUT_DIR / "osm-land-ne.wkb.json"
WATER_OUTPUT = OUTPUT_DIR / "osm-inland-water-ne.wkb.json"
FERRY_WAYS_OUTPUT = OUTPUT_DIR / "osm-ferry-ways.json"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "New England in Motion ferry geometry builder (+https://github.com/mapzimus/Motion)"

# west, south, east, north
LAND_BBOX = (-74.2, 40.7, -65.8, 47.8)
FERRY_WAY_BBOX = (-74.0, 40.9, -66.0, 47.5)
WATER_TILE = 0.1
CORRIDOR_BUFFER = 0.02
TILES_PER_QUERY = 8


def download_land(refresh=False):
    if LAND_ZIP.exists() and not refresh:
        print(f"Reusing {LAND_ZIP.name} ({LAND_ZIP.stat().st_size / 1e6:,.0f} MB)")
        return
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    partial = LAND_ZIP.with_suffix(".zip.part")
    request = urllib.request.Request(LAND_URL, headers={"User-Agent": USER_AGENT})
    print(f"Downloading {LAND_URL}", flush=True)
    with urllib.request.urlopen(request, timeout=300) as response, partial.open("wb") as handle:
        total = 0
        while True:
            chunk = response.read(4 * 1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
            total += len(chunk)
            if total % (100 * 1024 * 1024) < len(chunk):
                print(f"  {total / 1e6:,.0f} MB", flush=True)
    partial.replace(LAND_ZIP)


def extract_land():
    import shapefile
    from shapely import make_valid, to_wkb
    from shapely.geometry import box, shape

    clip = box(*LAND_BBOX)
    polygons = []
    extract_dir = OUTPUT_DIR / "land-polygons-extract"
    with zipfile.ZipFile(LAND_ZIP) as archive:
        # Zip members are not efficiently seekable; unpack the shapefile once.
        for name in archive.namelist():
            if Path(name).suffix in {".shp", ".shx", ".dbf"}:
                target = extract_dir / Path(name).name
                if not target.exists() or target.stat().st_size != archive.getinfo(name).file_size:
                    print(f"Extracting {name}", flush=True)
                    archive.extract(archive.getinfo(name), extract_dir)
                    (extract_dir / name).replace(target)
    with shapefile.Reader(str(extract_dir / "land_polygons.shp")) as reader:
        print(f"Scanning {len(reader):,} land polygons for the New England bbox", flush=True)
        for record in reader.iterShapes(bbox=LAND_BBOX):
            geometry = shape(record.__geo_interface__)
            if not geometry.is_valid:
                geometry = make_valid(geometry)
            geometry = geometry.intersection(clip)
            if geometry.is_empty or geometry.area == 0:
                continue
            polygons.append(geometry)
    write_wkb(LAND_OUTPUT, polygons, {
        "source": "OpenStreetMap land polygons (osmdata.openstreetmap.de)",
        "sourceUrl": LAND_URL,
        "license": "ODbL 1.0, (c) OpenStreetMap contributors",
        "bbox": LAND_BBOX,
    }, to_wkb)


def write_wkb(path, geometries, metadata, to_wkb, ids=None):
    payload = {
        "metadata": {**metadata, "fetchedAt": time.strftime("%Y-%m-%d"), "count": len(geometries)},
        "wkb": [base64.b64encode(to_wkb(geometry)).decode("ascii") for geometry in geometries],
    }
    if ids is not None:
        payload["ids"] = ids
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(geometries):,} polygons to {path} ({path.stat().st_size / 1e6:,.1f} MB)")


def overpass(query, attempts=5):
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last_error = None
    for attempt in range(attempts):
        request = urllib.request.Request(OVERPASS_URL, data=body, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                return json.load(response)
        except Exception as error:  # Overpass rate-limits with 429/504
            last_error = error
            wait = 20 * (attempt + 1)
            print(f"  Overpass error ({error}); retrying in {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"Overpass failed: {last_error}")


def fetch_ferry_ways():
    west, south, east, north = FERRY_WAY_BBOX
    query = f'[out:json][timeout:170];way["route"="ferry"]({south},{west},{north},{east});out tags geom;'
    result = overpass(query)
    FERRY_WAYS_OUTPUT.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(result.get('elements', [])):,} OSM ferry ways to {FERRY_WAYS_OUTPUT}")
    return result


def corridor_paths(ferry_ways):
    """Every ferry path we might draw: current build, catalogs, and OSM ways."""
    paths = []

    def add_geometry(geometry):
        if not geometry:
            return
        if geometry.get("type") == "LineString":
            paths.append(geometry["coordinates"])
        elif geometry.get("type") == "MultiLineString":
            paths.extend(geometry["coordinates"])

    for name in ("supplemental-routes.json", "supplemental-ferry-routes.json"):
        for feature in json.loads((ROOT / "scripts" / name).read_text(encoding="utf-8"))["features"]:
            if feature.get("properties", {}).get("group") == "ferry":
                add_geometry(feature.get("geometry"))
    routes = ROOT / "public" / "data" / "regional-routes.geojson"
    if routes.exists():
        for feature in json.loads(routes.read_text(encoding="utf-8")).get("features", []):
            if feature.get("properties", {}).get("group") == "ferry":
                add_geometry(feature.get("geometry"))
    cache = ROOT / "scripts" / "ferry-water-cache.json"
    if cache.exists():
        for record in json.loads(cache.read_text(encoding="utf-8")).get("routes", {}).values():
            add_geometry({"type": record.get("geometryType"), "coordinates": record.get("coordinates", [])})
    # OSM ferry ways only matter where they can be matched to our terminals.
    endpoints = [point for path in paths if path for point in (path[0], path[-1])]

    def near_endpoint(point):
        return any(abs(point[0] - e[0]) < 0.03 and abs(point[1] - e[1]) < 0.02 for e in endpoints)

    for element in ferry_ways.get("elements", []):
        way = [[node["lon"], node["lat"]] for node in element.get("geometry", [])]
        if len(way) >= 2 and near_endpoint(way[0]) and near_endpoint(way[-1]):
            paths.append(way)
    return [path for path in paths if len(path) >= 1 and isinstance(path[0], list)]


def corridor_tiles(paths):
    tiles = set()
    for path in paths:
        points = path if len(path) > 1 else path * 2
        for start, end in zip(points, points[1:]):
            steps = max(1, math.ceil(math.dist(start, end) / (WATER_TILE / 2)))
            for step in range(steps + 1):
                x = start[0] + (end[0] - start[0]) * step / steps
                y = start[1] + (end[1] - start[1]) * step / steps
                for dx in (-CORRIDOR_BUFFER, 0, CORRIDOR_BUFFER):
                    for dy in (-CORRIDOR_BUFFER, 0, CORRIDOR_BUFFER):
                        tiles.add((math.floor((x + dx) / WATER_TILE), math.floor((y + dy) / WATER_TILE)))
    west, south, east, north = LAND_BBOX
    return sorted(
        tile for tile in tiles
        if west <= tile[0] * WATER_TILE <= east and south <= tile[1] * WATER_TILE <= north
    )


def element_polygons(element):
    from shapely import make_valid
    from shapely.geometry import LineString, Polygon
    from shapely.ops import polygonize, unary_union

    if element["type"] == "way":
        ring = [(node["lon"], node["lat"]) for node in element.get("geometry", [])]
        if len(ring) >= 4 and ring[0] == ring[-1]:
            return make_valid(Polygon(ring))
        return None
    outers, inners = [], []
    for member in element.get("members", []):
        geometry = member.get("geometry")
        if member.get("type") != "way" or not geometry or len(geometry) < 2:
            continue
        line = LineString([(node["lon"], node["lat"]) for node in geometry])
        (inners if member.get("role") == "inner" else outers).append(line)
    if not outers:
        return None
    outer = unary_union(list(polygonize(unary_union(outers))))
    if inners:
        outer = outer.difference(unary_union(list(polygonize(unary_union(inners)))))
    return make_valid(outer) if not outer.is_empty else None


def dry_tiles(tiles, paths):
    """Keep only tiles where a ferry corridor crosses coastline land.

    Open water needs no inland-water lookup; lakes, rivers, and harbors behind
    a coastline closure all show up as "land" in the coastline polygons.
    """
    from shapely import from_wkb
    from shapely.geometry import LineString, box
    from shapely.strtree import STRtree

    payload = json.loads(LAND_OUTPUT.read_text(encoding="utf-8"))
    land = list(from_wkb([base64.b64decode(item) for item in payload["wkb"]]))
    land_tree = STRtree(land)
    lines = [LineString(path) for path in paths if len(path) >= 2]
    lines += [LineString([path[0], [path[0][0] + 1e-5, path[0][1]]]) for path in paths if len(path) == 1]
    line_tree = STRtree(lines)
    kept = []
    for x, y in tiles:
        cell = box(x * WATER_TILE, y * WATER_TILE, (x + 1) * WATER_TILE, (y + 1) * WATER_TILE)
        corridor = [lines[i].intersection(cell) for i in line_tree.query(cell.buffer(CORRIDOR_BUFFER), predicate="intersects")]
        corridor = [item.buffer(0.002) for item in corridor if not item.is_empty]
        if not corridor:
            continue
        if any(
            land[j].intersects(item)
            for item in corridor
            for j in land_tree.query(item, predicate="intersects")
        ):
            kept.append((x, y))
    return kept


def fetch_inland_water(ferry_ways, refresh=False):
    from shapely import from_wkb, to_wkb

    paths = corridor_paths(ferry_ways)
    tiles = dry_tiles(corridor_tiles(paths), paths)
    known_tiles, polygons, polygon_ids = set(), [], []
    if WATER_OUTPUT.exists() and not refresh:
        # Incremental: keep earlier polygons, fetch only corridor tiles that
        # are new (for example a newly added ferry route).
        previous = json.loads(WATER_OUTPUT.read_text(encoding="utf-8"))
        known_tiles = {tuple(tile) for tile in previous.get("metadata", {}).get("tiles", [])}
        if known_tiles and previous.get("ids"):
            polygons = list(from_wkb([base64.b64decode(item) for item in previous["wkb"]]))
            polygon_ids = list(previous["ids"])
        else:
            known_tiles = set()
    all_tiles = sorted(set(tiles) | known_tiles)
    tiles = [tile for tile in tiles if tile not in known_tiles]
    print(f"Fetching inland water for {len(tiles)} new ferry-corridor tiles", flush=True)
    by_id = {}
    for offset in range(0, len(tiles), TILES_PER_QUERY):
        batch = tiles[offset:offset + TILES_PER_QUERY]
        clauses = []
        for x, y in batch:
            bbox = f"{y * WATER_TILE:.4f},{x * WATER_TILE:.4f},{(y + 1) * WATER_TILE:.4f},{(x + 1) * WATER_TILE:.4f}"
            clauses.extend(
                f'{kind}["{key}"="{value}"]({bbox});'
                for kind in ("way", "relation")
                for key, value in (("natural", "water"), ("waterway", "riverbank"), ("waterway", "dock"))
            )
        query = "[out:json][timeout:240];(" + "".join(clauses) + ");out geom;"
        result = overpass(query)
        for element in result.get("elements", []):
            by_id[(element["type"], element["id"])] = element
        print(f"  [{offset + len(batch)}/{len(tiles)}] {len(by_id):,} water features so far", flush=True)
        time.sleep(2)
    existing = set(polygon_ids)
    for (kind, identifier), element in by_id.items():
        key = f"{kind}/{identifier}"
        if key in existing:
            continue
        try:
            polygon = element_polygons(element)
        except Exception as error:
            print(f"  skipped {key}: {error}")
            continue
        if polygon is not None and not polygon.is_empty and polygon.area > 0:
            polygons.append(polygon)
            polygon_ids.append(key)
    write_wkb(WATER_OUTPUT, polygons, {
        "source": "OpenStreetMap inland water via Overpass (natural=water, waterway=riverbank, waterway=dock)",
        "sourceUrl": OVERPASS_URL,
        "license": "ODbL 1.0, (c) OpenStreetMap contributors",
        "tileDegrees": WATER_TILE,
        "tileCount": len(all_tiles),
        "tiles": [list(tile) for tile in all_tiles],
    }, to_wkb, polygon_ids)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--refresh-land", action="store_true", help="download the land-polygon zip again")
    parser.add_argument("--skip-land", action="store_true", help="keep the existing clipped land file")
    parser.add_argument("--skip-water", action="store_true", help="keep the existing inland-water file")
    parser.add_argument("--refresh-water", action="store_true", help="refetch every inland-water tile")
    parser.add_argument("--skip-ferry-ways", action="store_true", help="keep the existing OSM ferry-way file")
    args = parser.parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    if not args.skip_land or not LAND_OUTPUT.exists():
        download_land(args.refresh_land)
        extract_land()
    if args.skip_ferry_ways and FERRY_WAYS_OUTPUT.exists():
        ferry_ways = json.loads(FERRY_WAYS_OUTPUT.read_text(encoding="utf-8"))
    else:
        ferry_ways = fetch_ferry_ways()
    if not args.skip_water or not WATER_OUTPUT.exists():
        fetch_inland_water(ferry_ways, args.refresh_water)
    print(f"Ferry water model ready in {time.monotonic() - started:,.0f}s")


if __name__ == "__main__":
    main()
