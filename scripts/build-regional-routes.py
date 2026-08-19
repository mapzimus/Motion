#!/usr/bin/env python3
"""Build a compact, checked-in GeoJSON of scheduled New England transit routes.

The browser never downloads GTFS zips. This script is run by maintainers (and CI)
to turn agency schedule feeds into simplified route ribbons that remain visible
even when an agency has no realtime vehicle-position feed.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "scripts" / "regional-feeds.json"
SUPPLEMENTAL_PATH = ROOT / "scripts" / "supplemental-routes.json"
BOUNDARIES_PATH = ROOT / "data" / "regions.geojson"
OUTPUT_PATH = ROOT / "data" / "regional-routes.geojson"
MNR_STOPS_PATH = ROOT / "data" / "mnr-stops.json"

NE_BOUNDS = (-75.0, 40.0, -65.0, 48.5)
TOLERANCE = 0.00022  # roughly 18–25 m in New England
STATE_COLORS = {
    "ct": "#49a6ff",
    "ma": "#ffc72c",
    "me": "#39c58a",
    "nh": "#b58cff",
    "ri": "#ff8e72",
    "vt": "#8fcf5b",
}
GROUP_BY_ROUTE_TYPE = {2: "commuter", 3: "bus", 4: "ferry"}


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Motion route builder/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = response.read(80 * 1024 * 1024 + 1)
    if len(payload) > 80 * 1024 * 1024:
        raise ValueError("feed exceeds the 80 MB safety limit")
    return payload


def member_name(archive: zipfile.ZipFile, wanted: str) -> str | None:
    wanted = wanted.lower()
    for name in archive.namelist():
        if Path(name).name.lower() == wanted:
            return name
    return None


def read_rows(archive: zipfile.ZipFile, wanted: str) -> list[dict[str, str]]:
    name = member_name(archive, wanted)
    if not name:
        return []
    raw = archive.read(name).decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(raw)))


def write_mnr_stops(archive: zipfile.ZipFile) -> None:
    stops = {}
    for row in read_rows(archive, "stops.txt"):
        try:
            stop_id = row["stop_id"]
            stops[stop_id] = {
                "name": row.get("stop_name") or stop_id,
                "lng": round(float(row["stop_lon"]), 6),
                "lat": round(float(row["stop_lat"]), 6),
            }
        except (KeyError, TypeError, ValueError):
            continue
    payload = {
        "source": "MTA Metro-North static GTFS",
        "sourceUrl": "https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip",
        "stops": stops,
    }
    MNR_STOPS_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def perpendicular_distance(point, start, end) -> float:
    if start == end:
        return math.dist(point, start)
    dx, dy = end[0] - start[0], end[1] - start[1]
    t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    projection = (start[0] + t * dx, start[1] + t * dy)
    return math.dist(point, projection)


def simplify(points, tolerance=TOLERANCE):
    if len(points) <= 2:
        return points
    start, end = points[0], points[-1]
    index, distance = max(
        ((i, perpendicular_distance(point, start, end)) for i, point in enumerate(points[1:-1], 1)),
        key=lambda pair: pair[1],
    )
    if distance <= tolerance:
        return [start, end]
    left = simplify(points[: index + 1], tolerance)
    right = simplify(points[index:], tolerance)
    return left[:-1] + right


def valid_point(lon: float, lat: float) -> bool:
    west, south, east, north = NE_BOUNDS
    return west <= lon <= east and south <= lat <= north


def point_in_ring(point, ring):
    x, y = point
    inside = False
    j = len(ring) - 1
    for i, (xi, yi) in enumerate(ring):
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or sys.float_info.epsilon) + xi:
            inside = not inside
        j = i
    return inside


def point_in_geometry(point, geometry):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    return any(point_in_ring(point, polygon[0]) and not any(point_in_ring(point, hole) for hole in polygon[1:]) for polygon in polygons)


def route_label(route: dict[str, str]) -> str:
    short = (route.get("route_short_name") or "").strip()
    long = (route.get("route_long_name") or "").strip()
    if short and long and short.lower() not in long.lower():
        return f"{short} · {long}"
    return short or long or route.get("route_id", "Route")


def parse_color(route, feed):
    candidate = (route.get("route_color") or "").strip().lstrip("#")
    if re.fullmatch(r"[0-9A-Fa-f]{6}", candidate) and candidate.lower() not in {"ffffff", "000000"}:
        return f"#{candidate.lower()}"
    return feed.get("color") or STATE_COLORS.get(feed["states"][0], "#ffc72c")


def coordinates_from_stops(archive, selected_trip_ids):
    if not selected_trip_ids:
        return {}
    stops = {
        row.get("stop_id"): (float(row["stop_lon"]), float(row["stop_lat"]))
        for row in read_rows(archive, "stops.txt")
        if row.get("stop_id") and row.get("stop_lon") and row.get("stop_lat")
    }
    sequences = defaultdict(list)
    for row in read_rows(archive, "stop_times.txt"):
        trip_id = row.get("trip_id")
        stop_id = row.get("stop_id")
        if trip_id in selected_trip_ids and stop_id in stops:
            try:
                sequence = int(row.get("stop_sequence") or 0)
            except ValueError:
                sequence = len(sequences[trip_id])
            sequences[trip_id].append((sequence, stops[stop_id]))
    return {trip_id: [point for _, point in sorted(values)] for trip_id, values in sequences.items()}


def process_feed(feed, region_geometries):
    payload = download(feed["url"])
    archive = zipfile.ZipFile(io.BytesIO(payload))
    if feed["id"] == "metro-north":
        write_mnr_stops(archive)
    routes = {row.get("route_id"): row for row in read_rows(archive, "routes.txt") if row.get("route_id")}
    pattern = re.compile(feed["route_name_pattern"], re.I) if feed.get("route_name_pattern") else None
    selected_routes = {}
    for route_id, route in routes.items():
        try:
            route_type = int(route.get("route_type") or -1)
        except ValueError:
            continue
        if route_type not in GROUP_BY_ROUTE_TYPE:
            continue
        if pattern and not pattern.search(route_label(route)):
            continue
        selected_routes[route_id] = route

    shape_to_route = {}
    fallback_trip_by_route_direction = {}
    for trip in read_rows(archive, "trips.txt"):
        route_id = trip.get("route_id")
        if route_id not in selected_routes:
            continue
        shape_id = (trip.get("shape_id") or "").strip()
        if shape_id:
            shape_to_route.setdefault(shape_id, route_id)
        else:
            key = (route_id, trip.get("direction_id") or "")
            fallback_trip_by_route_direction.setdefault(key, trip.get("trip_id"))

    shape_points = defaultdict(list)
    for row in read_rows(archive, "shapes.txt"):
        shape_id = row.get("shape_id")
        if shape_id not in shape_to_route:
            continue
        try:
            lon = float(row["shape_pt_lon"])
            lat = float(row["shape_pt_lat"])
            sequence = int(row.get("shape_pt_sequence") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        shape_points[shape_id].append((sequence, (lon, lat)))

    geometries = []
    for shape_id, values in shape_points.items():
        geometries.append((shape_to_route[shape_id], [point for _, point in sorted(values)]))

    fallback_trips = {trip_id for trip_id in fallback_trip_by_route_direction.values() if trip_id}
    stop_geometries = coordinates_from_stops(archive, fallback_trips)
    route_for_fallback = {trip_id: key[0] for key, trip_id in fallback_trip_by_route_direction.items()}
    geometries.extend((route_for_fallback[trip_id], points) for trip_id, points in stop_geometries.items())

    seen = set()
    paths_by_route = defaultdict(list)
    route_regions = defaultdict(set)
    for route_id, points in geometries:
        points = [point for point in points if valid_point(*point)]
        if len(points) < 2:
            continue
        path_regions = {
            region for region, geometry in region_geometries.items()
            if any(point_in_geometry(point, geometry) for point in points)
        }
        # National intercity feeds reuse route IDs across many trip patterns.
        # Keep only paths that actually touch New England so a Boston/NYC
        # service cannot pull unrelated southern or western variants onto the
        # regional map.
        if feed.get("require_region_match") and not path_regions:
            continue
        route_regions[route_id].update(path_regions)
        points = [(round(lon, 5), round(lat, 5)) for lon, lat in simplify(points)]
        signature = (route_id, tuple(points))
        if signature in seen:
            continue
        seen.add(signature)
        paths_by_route[route_id].append(points)

    features = []
    for route_id, paths in paths_by_route.items():
        route = selected_routes[route_id]
        route_type = int(route.get("route_type") or 3)
        detected_regions = route_regions.get(route_id) or set(feed["states"])
        regions = [key for key in ("ct", "ma", "me", "nh", "ri", "vt", "boston") if key in detected_regions]
        properties = {
            "route": f"{feed['id']}:{route_id}",
            "group": GROUP_BY_ROUTE_TYPE[route_type],
            "color": parse_color(route, feed),
            "agency": feed.get("agency_names", {}).get(route.get("agency_id"), feed["agency"]),
            "name": route_label(route),
            "kind": "regional-static",
            "regions": regions,
        }
        if feed.get("source_url"):
            properties["sourceUrl"] = feed["source_url"]
        features.append({
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": paths},
            "properties": properties,
        })
    return features, len(selected_routes)


def main():
    feeds = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    boundaries = json.loads(BOUNDARIES_PATH.read_text(encoding="utf-8"))
    region_geometries = {
        feature["properties"]["key"]: feature["geometry"]
        for feature in boundaries["features"]
    }
    all_features = []
    successes = []
    failures = []
    for index, feed in enumerate(feeds, 1):
        print(f"[{index:02}/{len(feeds)}] {feed['agency']}...", flush=True)
        try:
            features, route_count = process_feed(feed, region_geometries)
            all_features.extend(features)
            successes.append({"id": feed["id"], "agency": feed["agency"], "routes": route_count, "features": len(features)})
            print(f"     {route_count} routes, {len(features)} shapes")
        except Exception as error:  # continue so one seasonal feed cannot erase the regional map
            failures.append({"id": feed["id"], "agency": feed["agency"], "error": str(error)})
            print(f"     skipped: {error}")

    supplemental = json.loads(SUPPLEMENTAL_PATH.read_text(encoding="utf-8"))
    supplemental_features = supplemental.get("features", [])
    for feature in supplemental_features:
        geometry = feature.get("geometry", {})
        paths = geometry.get("coordinates", [])
        if geometry.get("type") == "LineString":
            paths = [paths]
        points = [tuple(point) for path in paths for point in path]
        detected = {
            key for key, region_geometry in region_geometries.items()
            if any(point_in_geometry(point, region_geometry) for point in points)
        }
        declared = feature.get("properties", {}).get("regions", [])
        combined = set(declared) | detected
        ordered = [key for key in ("ct", "ma", "me", "nh", "ri", "vt", "boston") if key in combined]
        ordered.extend(key for key in declared if key not in ordered)
        feature["properties"]["regions"] = ordered
    all_features.extend(supplemental_features)
    successes.append({
        "id": "supplemental-official-schedules",
        "agency": "Official schedule corridors without usable GTFS",
        "routes": len(supplemental_features),
        "features": len(supplemental_features),
    })

    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "description": "Scheduled New England transit routes generated from GTFS and clearly labeled official schedule corridors.",
            "sources": successes,
            "failed_sources": failures,
        },
        "features": all_features,
    }
    OUTPUT_PATH.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(all_features)} features from {len(successes)} feeds to {OUTPUT_PATH}")
    if failures:
        print(f"Skipped {len(failures)} feeds; see metadata.failed_sources in the output.")


if __name__ == "__main__":
    main()
