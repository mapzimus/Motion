#!/usr/bin/env python3
"""Build a compact, checked-in GeoJSON of scheduled New England transit routes.

The browser never downloads GTFS zips. This script is run by maintainers (and CI)
to turn agency schedule feeds into simplified route ribbons that remain visible
even when an agency has no realtime vehicle-position feed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "scripts" / "regional-feeds.json"
SUPPLEMENTAL_PATH = ROOT / "scripts" / "supplemental-routes.json"
ROAD_ROUTE_CACHE_PATH = ROOT / "scripts" / "road-route-cache.json"
ROAD_ROUTE_CONTROLS_PATH = ROOT / "scripts" / "road-route-controls.json"
BOUNDARIES_PATH = ROOT / "data" / "regions.geojson"
OUTPUT_PATH = ROOT / "data" / "regional-routes.geojson"
MNR_STOPS_PATH = ROOT / "data" / "mnr-stops.json"

NE_BOUNDS = (-75.0, 40.0, -65.0, 48.5)
TOLERANCE = 0.00022  # roughly 18–25 m in New England
MAX_BUS_CHORD_KM = 20.0
OSRM_BASE_URL = "https://router.project-osrm.org"
ROAD_ROUTING_VERSION = "osrm-driving-bus-controls-v4"
MAX_ROAD_DETOUR_RATIO = 1.6
MAX_ROAD_DETOUR_ALLOWANCE_KM = 5.0
ROAD_GEOMETRY_NOTE = "Approximate road-following path from published stops; the carrier may use a different roadway."
RESTRICTED_BUS_ROAD_PATTERN = re.compile(
    r"\b(?:Merritt|Wilbur Cross|Hutchinson River|Saw Mill River|Henry Hudson|Mosholu|"
    r"Palisades Interstate|Taconic State|Bronx River|Belt|Cross Island|Jackie Robinson|"
    r"Grand Central|Cross County|Sprain Brook|Bear Mountain|Lake Welch|Pelham|Ocean|"
    r"Korean War Veterans) (?:Parkway|Pkwy)\b|"
    r"\b(?:FDR|Franklin D\.? Roosevelt|Harlem River) (?:Drive|Dr)\b",
    re.I,
)
RESTRICTED_BUS_REF_PATTERN = re.compile(r"(?:^|[;,\s])CT[- ]?15(?:$|[;,\s])", re.I)
GROUP_BY_ROUTE_TYPE = {2: "commuter", 3: "bus", 4: "ferry"}
MODE_COLORS = {2: "#a58add", 3: "#f2b84b", 4: "#2eb7c5"}


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


def contiguous_valid_runs(points):
    """Split at the regional build boundary instead of joining across it."""
    runs = []
    current = []
    for point in points:
        if valid_point(*point):
            current.append(point)
        else:
            if len(current) >= 2:
                runs.append(current)
            current = []
    if len(current) >= 2:
        runs.append(current)
    return runs


def haversine_km(start, end):
    lon1, lat1 = map(math.radians, start)
    lon2, lat2 = map(math.radians, end)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(value))


def polyline_km(points):
    return sum(haversine_km(start, end) for start, end in zip(points, points[1:]))


def simplify_bus_path(points):
    """Simplify a bus path without creating another map-spanning chord."""
    if len(points) <= 2:
        return points
    start, end = points[0], points[-1]
    index, distance = max(
        ((i, perpendicular_distance(point, start, end)) for i, point in enumerate(points[1:-1], 1)),
        key=lambda pair: pair[1],
    )
    if distance <= TOLERANCE and haversine_km(start, end) <= MAX_BUS_CHORD_KM:
        return [start, end]
    if distance <= TOLERANCE:
        index = len(points) // 2
    left = simplify_bus_path(points[: index + 1])
    right = simplify_bus_path(points[index:])
    return left[:-1] + right


def road_loop_metrics(points):
    start, end = points[0], points[-1]
    mean_latitude = math.radians((start[1] + end[1]) / 2)
    x_scale = 111.32 * math.cos(mean_latitude)
    y_scale = 110.57
    end_x = (end[0] - start[0]) * x_scale
    end_y = (end[1] - start[1]) * y_scale
    magnitude = math.hypot(end_x, end_y) or 1
    unit_x, unit_y = end_x / magnitude, end_y / magnitude
    progress = [
        (point[0] - start[0]) * x_scale * unit_x + (point[1] - start[1]) * y_scale * unit_y
        for point in points
    ]
    backtracking_km = 0
    max_progress = progress[0]
    max_drawdown_km = 0
    for previous, current in zip(progress, progress[1:]):
        backtracking_km += max(0, previous - current)
        max_progress = max(max_progress, current)
        max_drawdown_km = max(max_drawdown_km, max_progress - current)

    cumulative = [0]
    for previous, current in zip(points, points[1:]):
        cumulative.append(cumulative[-1] + haversine_km(previous, current))
    first_occurrence = {}
    max_repeat_separation_km = 0
    for index, point in enumerate(points):
        token = coordinate_token(point)
        if token in first_occurrence and index - first_occurrence[token][0] > 2:
            max_repeat_separation_km = max(
                max_repeat_separation_km,
                cumulative[index] - first_occurrence[token][1],
            )
        else:
            first_occurrence.setdefault(token, (index, cumulative[index]))
    return backtracking_km, max_drawdown_km, max_repeat_separation_km


def coordinate_token(point):
    return f"{point[0]:.5f},{point[1]:.5f}"


def dedupe_consecutive(points):
    deduped = []
    for point in points:
        if not deduped or coordinate_token(point) != coordinate_token(deduped[-1]):
            deduped.append(point)
    return deduped


def road_segment_key(start, end):
    first, second = sorted((coordinate_token(start), coordinate_token(end)))
    return f"driving:{first}|{second}"


def normalized_sha256(raw):
    return hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest()


def load_road_route_controls():
    raw = ROAD_ROUTE_CONTROLS_PATH.read_bytes()
    controls = json.loads(raw)
    controls.setdefault("corridors", {})
    controls.setdefault("segments", {})
    for corridor_name, corridor_controls in controls["corridors"].items():
        if not isinstance(corridor_controls, list):
            raise ValueError(f"road-control corridor {corridor_name!r} must be a list")
        for index, control in enumerate(corridor_controls):
            validate_road_control(control, f"corridor {corridor_name!r} control {index}")
    for segment_key, definition in controls["segments"].items():
        if not isinstance(definition, dict):
            raise ValueError(f"road-control segment {segment_key!r} must be an object")
        for corridor_name in definition.get("corridors", []):
            if corridor_name not in controls["corridors"]:
                raise ValueError(f"road-control segment {segment_key!r} references unknown corridor {corridor_name!r}")
        for index, control in enumerate(definition.get("via", [])):
            validate_road_control(control, f"segment {segment_key!r} control {index}")
    return controls, normalized_sha256(raw)


def validate_road_control(control, label):
    if not isinstance(control, dict):
        raise ValueError(f"{label} must be an object")
    coordinate = control.get("coordinate")
    if (
        not isinstance(coordinate, list)
        or len(coordinate) != 2
        or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in coordinate)
        or not valid_point(*coordinate)
    ):
        raise ValueError(f"{label} has an invalid coordinate")
    bearing = control.get("bearing")
    if bearing is not None and (
        not isinstance(bearing, (int, float)) or not math.isfinite(bearing) or not 0 <= bearing < 360
    ):
        raise ValueError(f"{label} has an invalid bearing")
    bearing_range = control.get("range")
    if bearing_range is not None and (
        bearing is None
        or not isinstance(bearing_range, (int, float))
        or not math.isfinite(bearing_range)
        or not 0 < bearing_range <= 180
    ):
        raise ValueError(f"{label} has an invalid bearing range")


def resolved_road_controls(start, end, road_controls):
    definition = road_controls["segments"].get(road_segment_key(start, end), {})
    values = []
    for corridor in definition.get("corridors", []):
        values.extend(dict(control) for control in road_controls["corridors"].get(corridor, []))
    values.extend(dict(control) for control in definition.get("via", []))
    if coordinate_token(start) > coordinate_token(end):
        values.reverse()
        for control in values:
            if control.get("bearing") is not None:
                control["bearing"] = (float(control["bearing"]) + 180) % 360
    return values


def road_request_signature(start, end, controls_sha256):
    return f"{ROAD_ROUTING_VERSION}|{controls_sha256}|{road_segment_key(start, end)}"


def load_road_route_cache(controls_sha256):
    if ROAD_ROUTE_CACHE_PATH.exists():
        cache = json.loads(ROAD_ROUTE_CACHE_PATH.read_text(encoding="utf-8"))
    else:
        cache = {}
    cache.setdefault("description", "Build-time road geometry used to replace long straight gaps in scheduled bus routes.")
    cache.setdefault("router", "Project OSRM driving profile using OpenStreetMap data")
    cache.setdefault("sourceUrl", "https://project-osrm.org/")
    cache["routingVersion"] = ROAD_ROUTING_VERSION
    cache["controlsSha256"] = controls_sha256
    cache.setdefault("segments", {})
    return cache


def validate_road_geometry(start, end, points):
    if len(points) < 2:
        raise ValueError("road geometry has fewer than two coordinates")
    forward_error = haversine_km(start, points[0]) + haversine_km(end, points[-1])
    reverse_error = haversine_km(start, points[-1]) + haversine_km(end, points[0])
    if min(forward_error, reverse_error) > 0.2:
        raise ValueError("road geometry endpoints do not match the requested gap")
    direct_km = haversine_km(start, end)
    routed_km = polyline_km(points)
    if routed_km < direct_km * 0.9:
        raise ValueError(f"road geometry is shorter than its {direct_km:.1f} km endpoint gap")
    if routed_km > direct_km * MAX_ROAD_DETOUR_RATIO + MAX_ROAD_DETOUR_ALLOWANCE_KM:
        raise ValueError(f"road geometry detours {routed_km:.1f} km around a {direct_km:.1f} km gap")
    if any(coordinate_token(first) == coordinate_token(second) for first, second in zip(points, points[1:])):
        raise ValueError("road geometry contains consecutive duplicate coordinates")
    backtracking_km, max_drawdown_km, repeat_separation_km = road_loop_metrics(points)
    if repeat_separation_km > max(5, direct_km * 0.02):
        raise ValueError("road geometry retraces an earlier section")
    if (
        backtracking_km > max(5, direct_km * 0.08)
        and max_drawdown_km > max(5, direct_km * 0.03)
    ):
        raise ValueError("road geometry contains excessive backtracking")
    return routed_km, direct_km


def validate_bus_safe_steps(route):
    audited_roads = set()
    ct15_segments = []
    for leg in route.get("legs", []):
        for step in leg.get("steps", []):
            road_parts = [str(step.get(field) or "").strip() for field in ("name", "ref", "rotary_name")]
            road_parts = [part for part in road_parts if part]
            road_name = " · ".join(road_parts)
            if road_name:
                audited_roads.add(road_name)
            if RESTRICTED_BUS_ROAD_PATTERN.search(road_name):
                raise ValueError(f"OSRM selected a bus-restricted road: {road_name}")
            if RESTRICTED_BUS_REF_PATTERN.search(road_name):
                coordinates = step.get("geometry", {}).get("coordinates", [])
                valid_coordinates = [
                    point for point in coordinates
                    if isinstance(point, list) and len(point) >= 2
                ]
                if valid_coordinates:
                    longitudes = [point[0] for point in valid_coordinates]
                    latitudes = [point[1] for point in valid_coordinates]
                    bbox = [min(longitudes), min(latitudes), max(longitudes), max(latitudes)]
                else:
                    bbox = None
                distance_km = float(step.get("distance") or 0) / 1000
                ct15_segments.append({
                    "distanceKm": round(distance_km, 3),
                    "bbox": [round(value, 5) for value in bbox] if bbox else None,
                })
                # CT 15 also labels the short Hartford freeway connector used
                # to reach I-91. The restricted Merritt/Wilbur Cross sections
                # lie south or west of this bounding box.
                if (
                    not bbox
                    or bbox[1] < 41.65
                    or bbox[0] < -72.75
                    or distance_km > 8
                ):
                    raise ValueError(f"OSRM selected a bus-restricted CT 15 segment: {road_name}")
    return {
        "version": "osrm-steps-road-names-v2",
        "roads": sorted(audited_roads),
        "ct15Segments": ct15_segments,
    }


def fetch_road_segment(start, end, routing_state, road_controls):
    elapsed = time.monotonic() - routing_state["last_request_at"]
    if elapsed < 1.05:
        time.sleep(1.05 - elapsed)
    controls = resolved_road_controls(start, end, road_controls)
    request_points = [tuple(start), *(tuple(control["coordinate"]) for control in controls), tuple(end)]
    coordinates = ";".join(coordinate_token(point) for point in request_points)
    query_values = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "true",
        "generate_hints": "false",
        "continue_straight": "true",
    }
    if any(control.get("bearing") is not None for control in controls):
        bearings = [""]
        for control in controls:
            if control.get("bearing") is None:
                bearings.append("")
            else:
                bearings.append(f"{float(control['bearing']):g},{float(control.get('range', 25)):g}")
        bearings.append("")
        query_values["bearings"] = ";".join(bearings)
    query = urllib.parse.urlencode(query_values)
    url = f"{OSRM_BASE_URL}/route/v1/driving/{coordinates}?{query}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Motion route builder/1.0 (+https://github.com/mapzimus/Motion)"},
    )
    routing_state["last_request_at"] = time.monotonic()
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read(12 * 1024 * 1024 + 1)
    if len(raw) > 12 * 1024 * 1024:
        raise ValueError("OSRM response exceeds the 12 MB safety limit")
    payload = json.loads(raw)
    if payload.get("code") != "Ok" or not payload.get("routes"):
        raise ValueError(f"OSRM route failed: {payload.get('code', 'unknown response')}")
    snapped_waypoints = payload.get("waypoints", [])
    if len(snapped_waypoints) != len(request_points) or any(float(point.get("distance", 501)) > 500 for point in snapped_waypoints):
        raise ValueError("OSRM could not snap a bus waypoint within 500 m")
    route = payload["routes"][0]
    if len(route.get("legs", [])) != len(request_points) - 1:
        raise ValueError("OSRM returned an unexpected number of route legs")
    road_audit = validate_bus_safe_steps(route)
    direct_km = haversine_km(start, end)
    routed_km = float(route.get("distance", 0)) / 1000
    if routed_km < direct_km * 0.9 or routed_km > direct_km * MAX_ROAD_DETOUR_RATIO + MAX_ROAD_DETOUR_ALLOWANCE_KM:
        raise ValueError(f"OSRM returned an implausible {routed_km:.1f} km route for a {direct_km:.1f} km gap")
    routed = [tuple(start)]
    routed.extend(tuple(point) for point in route.get("geometry", {}).get("coordinates", []))
    routed.append(tuple(end))
    if len(routed) < 4:
        raise ValueError("OSRM returned no usable road geometry")
    routed = [(round(lon, 5), round(lat, 5)) for lon, lat in simplify_bus_path(routed)]
    routed[0], routed[-1] = tuple(start), tuple(end)
    routed = dedupe_consecutive(routed)
    validate_road_geometry(start, end, routed)
    return routed, road_audit


def cached_road_segment(
    start,
    end,
    road_cache,
    road_controls,
    controls_sha256,
    update_cache,
    refresh_cache,
    routing_state,
):
    key = road_segment_key(start, end)
    record = road_cache["segments"].get(key)
    expected_signature = road_request_signature(start, end, controls_sha256)
    if record is not None:
        try:
            if record.get("requestSignature") != expected_signature:
                raise ValueError("cache entry uses an obsolete routing request")
            if record.get("roadAudit", {}).get("version") != "osrm-steps-road-names-v2":
                raise ValueError("cache entry predates the bus-restriction audit")
            validate_road_geometry(start, end, [tuple(point) for point in record.get("coordinates", [])])
        except Exception as error:
            routing_state["cache_errors"][key] = str(error)
            record = None
    should_refresh = refresh_cache and key not in routing_state["refresh_attempted_keys"]
    if (record is None and update_cache) or should_refresh:
        routing_state["refresh_attempted_keys"].add(key)
        if coordinate_token(start) <= coordinate_token(end):
            canonical_start, canonical_end = tuple(start), tuple(end)
        else:
            canonical_start, canonical_end = tuple(end), tuple(start)
        try:
            routed, road_audit = fetch_road_segment(
                canonical_start,
                canonical_end,
                routing_state,
                road_controls,
            )
        except Exception as error:
            routing_state["fetch_errors"][key] = str(error)
            print(f"       road routing failed for {key}: {error}", flush=True)
            return None
        canonical = routed
        distance_km, direct_km = validate_road_geometry(canonical[0], canonical[-1], canonical)
        record = {
            "from": list(canonical[0]),
            "to": list(canonical[-1]),
            "requestSignature": expected_signature,
            "roadAudit": road_audit,
            "distanceKm": round(distance_km, 3),
            "directKm": round(direct_km, 3),
            "coordinates": [list(point) for point in canonical],
        }
        road_cache["segments"][key] = record
        routing_state["cache_dirty"] = True
        routing_state["fetched"] += 1
        print(f"       cached road geometry for {coordinate_token(start)} → {coordinate_token(end)}", flush=True)
    if record is None:
        return None
    routed = [tuple(point) for point in record.get("coordinates", [])]
    try:
        validate_road_geometry(start, end, routed)
    except ValueError as error:
        routing_state["cache_errors"][key] = str(error)
        return None
    if haversine_km(start, routed[0]) > haversine_km(start, routed[-1]):
        routed.reverse()
    routed[0], routed[-1] = tuple(start), tuple(end)
    routing_state["used"] += 1
    routing_state["used_keys"].add(key)
    return routed


def repair_long_road_gaps(
    points,
    route_key,
    road_cache,
    road_controls,
    controls_sha256,
    update_cache,
    refresh_cache,
    routing_state,
):
    if len(points) < 2:
        return [], 0
    paths = []
    current = [tuple(points[0])]
    repair_count = 0
    for start, end in zip(points, points[1:]):
        start, end = tuple(start), tuple(end)
        if haversine_km(start, end) <= MAX_BUS_CHORD_KM:
            current.append(end)
            continue
        routed = cached_road_segment(
            start,
            end,
            road_cache,
            road_controls,
            controls_sha256,
            update_cache,
            refresh_cache,
            routing_state,
        )
        if routed:
            current.extend(routed[1:])
            repair_count += 1
            continue
        if len(current) >= 2:
            paths.append(current)
        current = [end]
        routing_state["missing"].add(f"{route_key} [{coordinate_token(start)} → {coordinate_token(end)}]")
    if len(current) >= 2:
        paths.append(current)
    return paths, repair_count


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


def mode_color(route_type):
    return MODE_COLORS.get(route_type, "#8a949f")


def effective_route_type(feed, route):
    override = feed.get("route_type_override")
    if override is not None:
        return int(override)
    return int(route.get("route_type") or -1)


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


def process_feed(
    feed,
    region_geometries,
    road_cache,
    road_controls,
    controls_sha256,
    update_road_cache,
    refresh_road_cache,
    routing_state,
):
    payload = download(feed["url"])
    archive = zipfile.ZipFile(io.BytesIO(payload))
    if feed["id"] == "metro-north":
        write_mnr_stops(archive)
    routes = {row.get("route_id"): row for row in read_rows(archive, "routes.txt") if row.get("route_id")}
    pattern = re.compile(feed["route_name_pattern"], re.I) if feed.get("route_name_pattern") else None
    selected_routes = {}
    for route_id, route in routes.items():
        try:
            route_type = effective_route_type(feed, route)
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

    # Keep blank-shape trip patterns even when another trip on the same route
    # has a shape. National intercity feeds sometimes publish only a short city
    # fragment as the shaped trip; the stop-sequence fallback carries the full
    # advertised corridor and is road-routed below instead of drawn as a chord.
    fallback_trips = {trip_id for trip_id in fallback_trip_by_route_direction.values() if trip_id}
    stop_geometries = coordinates_from_stops(archive, fallback_trips)
    route_for_fallback = {trip_id: key[0] for key, trip_id in fallback_trip_by_route_direction.items()}
    geometries.extend((route_for_fallback[trip_id], points) for trip_id, points in stop_geometries.items())

    seen = set()
    paths_by_route = defaultdict(list)
    route_regions = defaultdict(set)
    approximate_routes = set()
    for route_id, source_points in geometries:
        for points in contiguous_valid_runs(source_points):
            source_path_regions = {
                region for region, geometry in region_geometries.items()
                if any(point_in_geometry(point, geometry) for point in points)
            }
            # National intercity feeds reuse route IDs across many trip patterns.
            # Keep only paths that actually touch New England so a Boston/NYC
            # service cannot pull unrelated southern or western variants onto the
            # regional map.
            if feed.get("require_region_match") and not source_path_regions:
                continue
            points = [(round(lon, 5), round(lat, 5)) for lon, lat in points]
            route_type = effective_route_type(feed, selected_routes[route_id])
            routed_paths, repair_count = ([points], 0)
            if route_type == 3:
                routed_paths, repair_count = repair_long_road_gaps(
                    points,
                    f"{feed['id']}:{route_id}",
                    road_cache,
                    road_controls,
                    controls_sha256,
                    update_road_cache,
                    refresh_road_cache,
                    routing_state,
                )
            if repair_count:
                approximate_routes.add(route_id)
            for routed_points in routed_paths:
                routed_points = simplify_bus_path(routed_points) if route_type == 3 else simplify(routed_points)
                path_regions = {
                    region for region, geometry in region_geometries.items()
                    if any(point_in_geometry(point, geometry) for point in routed_points)
                }
                route_regions[route_id].update(source_path_regions | path_regions)
                signature = (route_id, tuple(routed_points))
                if signature in seen:
                    continue
                seen.add(signature)
                paths_by_route[route_id].append(routed_points)

    features = []
    for route_id, paths in paths_by_route.items():
        route = selected_routes[route_id]
        route_type = effective_route_type(feed, route)
        detected_regions = route_regions.get(route_id) or set(feed["states"])
        regions = [key for key in ("ct", "ma", "me", "nh", "ri", "vt", "boston") if key in detected_regions]
        properties = {
            "route": f"{feed['id']}:{route_id}",
            "group": GROUP_BY_ROUTE_TYPE[route_type],
            "color": mode_color(route_type),
            "agency": feed.get("agency_names", {}).get(route.get("agency_id"), feed["agency"]),
            "name": route_label(route),
            "kind": "regional-static",
            "dataStatus": "scheduled",
            "provider": "Agency schedule · GTFS",
            "scheduleNote": "Published schedule route · live vehicle position shown separately when available",
            "regions": regions,
        }
        if route_id in approximate_routes:
            properties["geometryAccuracy"] = "approximate"
            properties["geometryProvider"] = "OpenStreetMap / Project OSRM"
            properties["geometryNote"] = ROAD_GEOMETRY_NOTE
            properties["scheduleNote"] += f" · {ROAD_GEOMETRY_NOTE}"
        properties["sourceUrl"] = feed.get("source_url") or "https://mobilitydatabase.org/"
        features.append({
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": paths},
            "properties": properties,
        })
    return features, len(selected_routes)


def main(update_road_cache=False, refresh_road_cache=False):
    feeds = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    boundaries = json.loads(BOUNDARIES_PATH.read_text(encoding="utf-8"))
    road_controls, controls_sha256 = load_road_route_controls()
    road_cache = load_road_route_cache(controls_sha256)
    routing_state = {
        "cache_errors": {},
        "cache_dirty": False,
        "fetch_errors": {},
        "fetched": 0,
        "last_request_at": 0.0,
        "missing": set(),
        "refresh_attempted_keys": set(),
        "used": 0,
        "used_keys": set(),
    }
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
            features, route_count = process_feed(
                feed,
                region_geometries,
                road_cache,
                road_controls,
                controls_sha256,
                update_road_cache,
                refresh_road_cache,
                routing_state,
            )
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
        if feature.get("properties", {}).get("group") == "bus":
            routed_paths = []
            repair_count = 0
            for path in paths:
                pieces, repaired = repair_long_road_gaps(
                    path,
                    feature["properties"].get("route", "supplemental bus route"),
                    road_cache,
                    road_controls,
                    controls_sha256,
                    update_road_cache,
                    refresh_road_cache,
                    routing_state,
                )
                routed_paths.extend(pieces)
                repair_count += repaired
            paths = [simplify_bus_path(path) for path in routed_paths]
            geometry["type"] = "MultiLineString"
            geometry["coordinates"] = paths
            if repair_count:
                feature["properties"]["geometryAccuracy"] = "approximate"
                feature["properties"]["geometryProvider"] = "OpenStreetMap / Project OSRM"
                feature["properties"]["geometryNote"] = ROAD_GEOMETRY_NOTE
                note = feature["properties"].get("scheduleNote", "Official carrier schedule")
                feature["properties"]["scheduleNote"] = f"{note} · {ROAD_GEOMETRY_NOTE}"
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
        feature["properties"]["dataStatus"] = "scheduled"
        feature["properties"]["color"] = {
            "bus": MODE_COLORS[3],
            "ferry": MODE_COLORS[4],
            "commuter": MODE_COLORS[2],
        }.get(feature["properties"].get("group"), "#8a949f")
        feature["properties"].setdefault("provider", "Official carrier schedule")
    all_features.extend(supplemental_features)
    successes.append({
        "id": "supplemental-official-schedules",
        "agency": "Official schedule corridors without usable GTFS",
        "routes": len(supplemental_features),
        "features": len(supplemental_features),
    })

    if routing_state["missing"]:
        missing = "\n  - ".join(sorted(routing_state["missing"]))
        fetch_errors = ""
        if routing_state["fetch_errors"]:
            fetch_errors = "\nRouting errors:\n  - " + "\n  - ".join(
                f"{key}: {error}" for key, error in sorted(routing_state["fetch_errors"].items())
            )
        cache_errors = ""
        if routing_state["cache_errors"]:
            cache_errors = "\nCache errors:\n  - " + "\n  - ".join(
                f"{key}: {error}" for key, error in sorted(routing_state["cache_errors"].items())
            )
        raise RuntimeError(
            "Missing cached road geometry for long bus-route gaps. "
            "Rerun with --update-road-cache while online:\n  - " + missing + fetch_errors + cache_errors
        )

    if not failures:
        stale_keys = set(road_cache["segments"]) - routing_state["used_keys"]
        for key in stale_keys:
            del road_cache["segments"][key]
        if stale_keys:
            routing_state["cache_dirty"] = True
            print(f"Pruned {len(stale_keys)} unused road-cache segments.")

    if routing_state["cache_dirty"]:
        cache_temp_path = ROAD_ROUTE_CACHE_PATH.with_suffix(".json.tmp")
        cache_temp_path.write_text(
            json.dumps(road_cache, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        cache_temp_path.replace(ROAD_ROUTE_CACHE_PATH)

    road_cache_sha256 = normalized_sha256(ROAD_ROUTE_CACHE_PATH.read_bytes())

    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "description": "Scheduled New England transit routes generated from GTFS and clearly labeled official schedule corridors.",
            "sources": successes,
            "failed_sources": failures,
            "roadGeometryRoutingVersion": ROAD_ROUTING_VERSION,
            "roadGeometryControlsSha256": controls_sha256,
            "roadGeometryCacheSha256": road_cache_sha256,
        },
        "features": all_features,
    }
    OUTPUT_PATH.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(all_features)} features from {len(successes)} feeds to {OUTPUT_PATH}")
    print(
        f"Road geometry: used {routing_state['used']} cached segments; "
        f"fetched {routing_state['fetched']} new segments."
    )
    if failures:
        print(f"Skipped {len(failures)} feeds; see metadata.failed_sources in the output.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--update-road-cache",
        action="store_true",
        help="fetch missing long-gap bus geometry from OSRM at build time",
    )
    parser.add_argument(
        "--refresh-road-cache",
        action="store_true",
        help="refetch every long-gap bus geometry from its published endpoints",
    )
    arguments = parser.parse_args()
    main(arguments.update_road_cache or arguments.refresh_road_cache, arguments.refresh_road_cache)
