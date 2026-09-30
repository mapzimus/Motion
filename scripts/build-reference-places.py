#!/usr/bin/env python3
"""Build the checked-in New England reference-places layer.

Four feature classes share one GeoJSON file, distinguished by ``group``:

* ``heritage-rail`` – hand-curated heritage and scenic railroads
  (scripts/heritage-railroads.json), snapped to the FRA rail network in
  data/infrastructure.geojson where the tourist line runs on a mapped railroad.
* ``park-ride`` – state DOT park-and-ride lots from ArcGIS REST services.
* ``ev-charging`` – public DC fast and Level 2 charging from the NREL/NLR
  Alternative Fuel Stations API (DEMO_KEY, rate limited).
* ``drawbridge`` – hand-curated movable bridges with 33 CFR 117 opening rules
  (scripts/drawbridges.json).

Every feature carries title, provider, sourceUrl, dataStatus 'reference', and a
``regions`` list computed against data/regions.geojson with the same
point-in-polygon tagging the other builders use.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "reference-places.geojson"
BOUNDARIES_PATH = ROOT / "data" / "regions.geojson"
INFRASTRUCTURE_PATH = ROOT / "data" / "infrastructure.geojson"
HERITAGE_PATH = ROOT / "scripts" / "heritage-railroads.json"
DRAWBRIDGE_PATH = ROOT / "scripts" / "drawbridges.json"
USER_AGENT = "mapzimus/Motion reference-places-builder"
# Region keys in scripts/regions-config.json order, filled from
# data/regions.geojson by load_region_geometries().
REGION_ORDER: list[str] = []

COLORS = {
    "heritage-rail": "#e07a5f",
    "park-ride": "#7fb7ff",
    "ev-charging": "#6ee7a8",
    "drawbridge": "#f7c948",
}

# State park-and-ride services. Rhode Island publishes no official RIDOT
# park-and-ride feature service, so it is intentionally absent.
PARK_RIDE_SOURCES = [
    {
        "state": "ma",
        "provider": "MassDOT GeoDOT · Park and Ride Lots",
        "sourceUrl": "https://geodot-massdot.hub.arcgis.com/maps/MassDOT::park-and-ride-lots/about",
        "layer": "https://gis.massdot.state.ma.us/arcgis/rest/services/Multimodal/ParkandRideLots/FeatureServer/0",
        "where": "1=1",
        "fields": {"town": "Municipali", "spaces": "Total_Spac", "location": "Address", "transit": "Bus_Servic"},
    },
    {
        "state": "ct",
        "provider": "CTDOT Open Data · Park And Ride Lots",
        "sourceUrl": "https://portal.ct.gov/dot/travel-gateway/roads-and-highways/park-and-ride",
        "layer": "https://services1.arcgis.com/FCaUeJ5SOVtImake/arcgis/rest/services/CTDOTParkAndRideView/FeatureServer/1",
        "where": "Status = 'Opened'",
        "fields": {"name": "Location", "town": "Town", "spaces": "TotalNumberOfSpaces", "highway": "Highway"},
    },
    {
        "state": "vt",
        "provider": "VTrans · Vermont Park and Ride Locations",
        "sourceUrl": "https://vtrans.vermont.gov/highway/parkandrides",
        "layer": "https://services1.arcgis.com/NXmBVyW5TaiCXqFs/arcgis/rest/services/Vermont_Park_and_Ride_Locations/FeatureServer/0",
        "where": "STATUS = 'O'",
        "fields": {"name": "STREET_ADDRESS", "town": "TOWN", "spaces": "SPACES", "highway": "ROUTE", "ev": "EV_CHRG"},
    },
    {
        "state": "nh",
        "provider": "NHDOT park-and-ride inventory (2013) via SWRPC ArcGIS",
        "sourceUrl": "https://www.dot.nh.gov/travel/transportation-alternatives/park-ride-lots",
        "layer": "https://services2.arcgis.com/Lh31gHjN8TojXgnP/arcgis/rest/services/NH_Park_and_Ride_Lots/FeatureServer/14",
        "where": "1=1",
        "fields": {"name": "LOCATION", "spaces": "SPACES"},
        "vintage": "NHDOT inventory as of 2013; verify current lot status before relying on it.",
    },
    {
        "state": "me",
        "provider": "MaineDOT Open Data · Park and Ride",
        "sourceUrl": "https://gis.maine.gov/mapservices/rest/services/dot/MaineDOT_OpenData/MapServer/8",
        "layer": "https://gis.maine.gov/mapservices/rest/services/dot/MaineDOT_OpenData/MapServer/8",
        "where": "1=1",
        "fields": {"name": "asset_descr", "town": "begin_town", "spaces": "total_num_spaces", "location": "location", "transit": "transit_other_services"},
    },
]

EV_API = "https://developer.nlr.gov/api/alt-fuel-stations/v1.geojson"
EV_SOURCE_PAGE = "https://afdc.energy.gov/stations/"
EV_PROVIDER = "NREL/NLR Alternative Fueling Station Locator (AFDC)"


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def fetch_json(url, timeout=180, attempts=4, backoff=3.0):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last_error = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as error:
            last_error = error
            if attempt < attempts - 1:
                wait = backoff * (2 ** attempt)
                print(f"  retry {attempt + 1}/{attempts - 1} after {wait:.0f}s: {error}", file=sys.stderr)
                time.sleep(wait)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


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


def geometry_bbox(geometry):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    xs = [x for polygon in polygons for x, _ in polygon[0]]
    ys = [y for polygon in polygons for _, y in polygon[0]]
    return (min(xs), min(ys), max(xs), max(ys))


def point_in_geometry(point, geometry):
    bbox = geometry.get("bbox")
    if bbox and not (bbox[0] <= point[0] <= bbox[2] and bbox[1] <= point[1] <= bbox[3]):
        return False
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    return any(
        point_in_ring(point, polygon[0]) and not any(point_in_ring(point, hole) for hole in polygon[1:])
        for polygon in polygons
    )


def load_region_geometries():
    boundaries = json.loads(BOUNDARIES_PATH.read_text(encoding="utf-8"))
    geometries = {
        feature["properties"]["key"]: {**feature["geometry"], "bbox": geometry_bbox(feature["geometry"])}
        for feature in boundaries["features"]
    }
    REGION_ORDER[:] = list(geometries)
    return geometries


def feature_points(geometry):
    coordinates = geometry.get("coordinates", [])
    if geometry.get("type") == "Point":
        return [coordinates]
    points = []

    def visit(value):
        if value and isinstance(value[0], (int, float)):
            points.append(value)
        else:
            for child in value:
                visit(child)

    visit(coordinates)
    return points


def retag_existing(path, region_geometries):
    """Recompute ``regions`` on an existing snapshot without refetching sources.

    Used after data/regions.geojson gains regions: states already stored on a
    feature are kept (some were declared rather than detected), and every
    region the geometry touches is added.
    """
    collection = json.loads(path.read_text(encoding="utf-8"))
    for feature in collection.get("features", []):
        properties = feature.setdefault("properties", {})
        declared = [key for key in properties.get("regions", []) if key in region_geometries]
        properties["regions"] = regions_for(feature_points(feature.get("geometry") or {}), region_geometries, declared)
    path.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Retagged {len(collection.get('features', []))} features in {path}")


def regions_for(points, region_geometries, declared=()):
    detected = {
        key for key, geometry in region_geometries.items()
        if any(point_in_geometry(tuple(point), geometry) for point in points)
    }
    combined = detected | set(declared)
    return [key for key in REGION_ORDER if key in combined]


def distance_km(start, end):
    lat1, lat2 = math.radians(start[1]), math.radians(end[1])
    dlat = math.radians(end[1] - start[1])
    dlon = math.radians(end[0] - start[0])
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(value))


def path_length_km(path):
    return sum(distance_km(path[index - 1], path[index]) for index in range(1, len(path)))


def rounded(point):
    return [round(point[0], 5), round(point[1], 5)]


def clean_text(value):
    if value is None:
        return ""
    return " ".join(str(value).split())


def clean_int(value):
    try:
        number = int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


# --------------------------------------------------------------------------
# Heritage rail: snap to the FRA network
# --------------------------------------------------------------------------

class RailGraph:
    """Undirected graph over FRA rail-line vertices for shortest-path snapping."""

    def __init__(self, features):
        self.adjacent: dict[tuple[float, float], list[tuple[tuple[float, float], float]]] = {}
        for feature in features:
            geometry = feature.get("geometry") or {}
            lines = geometry.get("coordinates", [])
            if geometry.get("type") == "LineString":
                lines = [lines]
            elif geometry.get("type") != "MultiLineString":
                continue
            for line in lines:
                previous = None
                for point in line:
                    node = (round(point[0], 5), round(point[1], 5))
                    self.adjacent.setdefault(node, [])
                    if previous is not None and previous != node:
                        weight = distance_km(previous, node)
                        self.adjacent[previous].append((node, weight))
                        self.adjacent[node].append((previous, weight))
                    previous = node
        self.nodes = list(self.adjacent)
        # Coarse spatial index for nearest-node lookups.
        self.cells: dict[tuple[int, int], list[tuple[float, float]]] = {}
        for node in self.nodes:
            self.cells.setdefault(self.cell(node), []).append(node)

    @staticmethod
    def cell(point):
        return (int(point[0] * 50), int(point[1] * 50))

    def nearest(self, point, max_km):
        cx, cy = self.cell(point)
        best, best_distance = None, max_km
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for node in self.cells.get((cx + dx, cy + dy), ()):
                    candidate = distance_km(point, node)
                    if candidate < best_distance:
                        best, best_distance = node, candidate
        return best, best_distance

    def shortest_path(self, start, goal, limit_km):
        distances = {start: 0.0}
        previous = {}
        queue = [(0.0, start)]
        while queue:
            cost, node = heapq.heappop(queue)
            if node == goal:
                break
            if cost > distances.get(node, math.inf) or cost > limit_km:
                continue
            for neighbour, weight in self.adjacent.get(node, ()):
                candidate = cost + weight
                if candidate < distances.get(neighbour, math.inf):
                    distances[neighbour] = candidate
                    previous[neighbour] = node
                    heapq.heappush(queue, (candidate, neighbour))
        if goal not in distances:
            return None
        path = [goal]
        while path[-1] != start:
            path.append(previous[path[-1]])
        path.reverse()
        return [list(node) for node in path]


def snap_route(waypoints, graph, snap_km=1.5, detour_ratio=1.8):
    """Return (coordinates, accuracy). Falls back to the waypoint chord."""
    chord = [rounded(point["coordinates"]) for point in waypoints]
    if graph is None:
        return chord, "approximate"
    snapped = []
    for point in waypoints:
        node, _ = graph.nearest(tuple(point["coordinates"]), snap_km)
        if node is None:
            return chord, "approximate"
        snapped.append(node)
    path = []
    for index in range(1, len(snapped)):
        start, goal = snapped[index - 1], snapped[index]
        straight = max(distance_km(start, goal), 0.5)
        limit = straight * detour_ratio + 3
        segment = graph.shortest_path(start, goal, limit)
        if segment is None or path_length_km(segment) > limit:
            return chord, "approximate"
        path.extend(segment if not path else segment[1:])
    return [rounded(point) for point in path], "rail-network"


def heritage_features(region_geometries, graph):
    catalog = json.loads(HERITAGE_PATH.read_text(encoding="utf-8"))
    features = []
    for railroad in catalog["railroads"]:
        waypoints = railroad["waypoints"]
        if railroad.get("snapToRail"):
            coordinates, accuracy = snap_route(waypoints, graph)
        else:
            coordinates, accuracy = [rounded(point["coordinates"]) for point in waypoints], "approximate"
        endpoints = f"{waypoints[0]['name']} ↔ {waypoints[-1]['name']}"
        length = path_length_km(coordinates)
        geometry_note = (
            "Route follows the FRA rail network between the named endpoints."
            if accuracy == "rail-network"
            else "Approximate alignment drawn between the named endpoints; the track is not in the FRA network snapshot."
        )
        features.append({
            "type": "Feature",
            "id": f"heritage-{railroad['id']}",
            "geometry": {"type": "LineString", "coordinates": coordinates},
            "properties": {
                "group": "heritage-rail",
                "dataStatus": "reference",
                "color": COLORS["heritage-rail"],
                "title": railroad["title"],
                "status": f"{railroad['kind']} · {endpoints}",
                "details": f"Operator: {railroad['operator']} · Season: {railroad['season']} · {length:.1f} km of route · {geometry_note}",
                "provider": railroad["operator"],
                "sourceUrl": railroad["url"],
                "operator": railroad["operator"],
                "season": railroad["season"],
                "endpoints": [point["name"] for point in waypoints],
                "geometryAccuracy": accuracy,
                "geometryNote": geometry_note,
                "state": railroad["state"],
                "regions": regions_for(coordinates, region_geometries, [railroad["state"]]),
            },
        })
        print(f"  heritage {railroad['id']}: {accuracy} ({length:.1f} km)")
    return features


# --------------------------------------------------------------------------
# Park-and-ride: state DOT ArcGIS REST services
# --------------------------------------------------------------------------

def query_arcgis(layer, where):
    features = []
    offset = 0
    page = 1000
    while True:
        params = {
            "where": where,
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": 4326,
            "resultOffset": offset,
            "resultRecordCount": page,
            "f": "geojson",
        }
        collection = fetch_json(f"{layer}/query?{urllib.parse.urlencode(params)}")
        if "error" in collection:
            raise RuntimeError(f"{layer}: {collection['error']}")
        batch = collection.get("features", [])
        features.extend(batch)
        if len(batch) < page and not collection.get("properties", {}).get("exceededTransferLimit"):
            break
        offset += len(batch)
        if not batch:
            break
    return features


def park_ride_features(region_geometries):
    features, sources = [], []
    for source in PARK_RIDE_SOURCES:
        state = source["state"]
        try:
            raw = query_arcgis(source["layer"], source["where"])
        except Exception as error:  # noqa: BLE001 - report and continue
            print(f"  park-ride {state}: SKIPPED ({error})", file=sys.stderr)
            sources.append({"state": state, "provider": source["provider"], "status": "skipped", "error": str(error)})
            continue
        fields = source["fields"]
        count = 0
        for index, item in enumerate(raw):
            geometry = item.get("geometry") or {}
            if geometry.get("type") != "Point":
                continue
            coordinates = rounded(geometry["coordinates"])
            props = item.get("properties") or {}
            name = clean_text(props.get(fields["name"])) if fields.get("name") else ""
            town = clean_text(props.get(fields.get("town", ""))).title() if fields.get("town") else ""
            if town and name.lower().startswith(town.lower() + ","):
                name = name[len(town) + 1:].strip()
            if name.isupper():
                name = name.title()
            spaces = clean_int(props.get(fields["spaces"])) if fields.get("spaces") else None
            highway = clean_text(props.get(fields.get("highway", ""))) if fields.get("highway") else ""
            location = clean_text(props.get(fields.get("location", ""))) if fields.get("location") else ""
            transit = clean_text(props.get(fields.get("transit", ""))) if fields.get("transit") else ""
            title = f"{town} park & ride" if town else (name or f"{state.upper()} park & ride")
            if town and name and name.lower() != town.lower():
                title = f"{town} · {name}"
            details = []
            if location:
                details.append(location)
            if highway:
                details.append(f"Route {highway}" if highway[:1].isdigit() else highway)
            if spaces:
                details.append(f"{spaces} spaces")
            if transit:
                details.append(f"Transit: {transit}")
            if fields.get("ev") and clean_text(props.get(fields["ev"])).upper().startswith("Y"):
                details.append("EV charging on site")
            if source.get("vintage"):
                details.append(source["vintage"])
            features.append({
                "type": "Feature",
                "id": f"park-ride-{state}-{index}",
                "geometry": {"type": "Point", "coordinates": coordinates},
                "properties": {
                    "group": "park-ride",
                    "dataStatus": "reference",
                    "color": COLORS["park-ride"],
                    "title": title,
                    "status": f"{state.upper()} DOT park-and-ride lot",
                    "details": " · ".join(details) or "Published state park-and-ride lot",
                    "provider": source["provider"],
                    "sourceUrl": source["sourceUrl"],
                    "name": name,
                    "town": town,
                    "spaces": spaces,
                    "state": state,
                    "regions": regions_for([coordinates], region_geometries, [state]),
                },
            })
            count += 1
        print(f"  park-ride {state}: {count} lots")
        sources.append({"state": state, "provider": source["provider"], "status": "ok", "count": count})
    return features, sources


# --------------------------------------------------------------------------
# EV charging: NREL/NLR AFDC
# --------------------------------------------------------------------------

def ev_features(region_geometries, api_key):
    params = {
        "api_key": api_key,
        "fuel_type": "ELEC",
        "status": "E",
        "access": "public",
        "state": "MA,CT,RI,NH,VT,ME",
        "limit": "all",
    }
    collection = fetch_json(f"{EV_API}?{urllib.parse.urlencode(params)}", timeout=300, attempts=5, backoff=10.0)
    features = []
    for item in collection.get("features", []):
        props = item.get("properties") or {}
        geometry = item.get("geometry") or {}
        if geometry.get("type") != "Point":
            continue
        dcfc = clean_int(props.get("ev_dc_fast_num")) or 0
        level2 = clean_int(props.get("ev_level2_evse_num")) or 0
        if not dcfc and not level2:
            continue
        coordinates = rounded(geometry["coordinates"])
        state = clean_text(props.get("state")).lower()
        network = clean_text(props.get("ev_network")) or "Non-Networked"
        connectors = sorted({clean_text(value) for value in props.get("ev_connector_types") or [] if value})
        ports = []
        if dcfc:
            ports.append(f"{dcfc} DC fast")
        if level2:
            ports.append(f"{level2} Level 2")
        details = [", ".join(ports) + " ports"]
        if connectors:
            details.append("Connectors: " + ", ".join(connectors))
        hours = clean_text(props.get("access_days_time"))
        if hours:
            details.append(hours[:120])
        pricing = clean_text(props.get("ev_pricing"))
        if pricing:
            details.append(f"Pricing: {pricing[:80]}")
        city = clean_text(props.get("city")).title()
        features.append({
            "type": "Feature",
            "id": f"ev-{props.get('id')}",
            "geometry": {"type": "Point", "coordinates": coordinates},
            "properties": {
                "group": "ev-charging",
                "dataStatus": "reference",
                "color": COLORS["ev-charging"],
                "title": clean_text(props.get("station_name")) or "EV charging station",
                "status": f"{'DC fast' if dcfc else 'Level 2'} charging · {network} · {city}, {state.upper()}",
                "details": " · ".join(details),
                "provider": EV_PROVIDER,
                "sourceUrl": EV_SOURCE_PAGE,
                "name": clean_text(props.get("station_name")),
                "network": network,
                "connectors": connectors,
                "dcfc": dcfc,
                "l2": level2,
                "fastCharge": bool(dcfc),
                "state": state,
                "regions": regions_for([coordinates], region_geometries, [state] if state in REGION_ORDER else []),
            },
        })
    print(f"  ev-charging: {len(features)} stations with DC fast or Level 2 ports")
    return features


# --------------------------------------------------------------------------
# Drawbridges: hand-curated
# --------------------------------------------------------------------------

def drawbridge_features(region_geometries):
    catalog = json.loads(DRAWBRIDGE_PATH.read_text(encoding="utf-8"))
    features = []
    for bridge in catalog["bridges"]:
        coordinates = rounded(bridge["coordinates"])
        features.append({
            "type": "Feature",
            "id": f"drawbridge-{bridge['id']}",
            "geometry": {"type": "Point", "coordinates": coordinates},
            "properties": {
                "group": "drawbridge",
                "dataStatus": "reference",
                "color": COLORS["drawbridge"],
                "title": bridge["name"],
                "status": f"{bridge['bridgeType']} bridge · {bridge['waterway']} · carries {bridge['carries']}",
                "details": f"{bridge['openingRule']} ({bridge['cfrSection']})",
                "provider": "U.S. Coast Guard drawbridge regulations · 33 CFR 117",
                "sourceUrl": bridge["sourceUrl"],
                "waterway": bridge["waterway"],
                "carries": bridge["carries"],
                "bridgeType": bridge["bridgeType"],
                "openingRule": bridge["openingRule"],
                "cfrSection": bridge["cfrSection"],
                "state": bridge["state"],
                "regions": regions_for([coordinates], region_geometries, [bridge["state"]]),
            },
        })
    print(f"  drawbridge: {len(features)} bridges")
    return features


# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--skip-ev", action="store_true", help="Do not call the AFDC API")
    parser.add_argument("--skip-park-ride", action="store_true", help="Do not call state park-and-ride services")
    parser.add_argument("--api-key", default=os.environ.get("NREL_API_KEY", "DEMO_KEY"))
    parser.add_argument(
        "--retag-only",
        action="store_true",
        help="Only recompute each feature's regions list in the existing output (offline)",
    )
    args = parser.parse_args()

    region_geometries = load_region_geometries()
    if args.retag_only:
        retag_existing(args.output, region_geometries)
        return
    graph = None
    if INFRASTRUCTURE_PATH.exists():
        infrastructure = json.loads(INFRASTRUCTURE_PATH.read_text(encoding="utf-8"))
        graph = RailGraph([f for f in infrastructure.get("features", []) if f.get("properties", {}).get("group") == "freight"])
        print(f"Rail graph: {len(graph.nodes)} vertices")
    else:
        print("data/infrastructure.geojson missing; heritage routes will be straight chords", file=sys.stderr)

    sources = []
    print("Heritage railroads")
    features = heritage_features(region_geometries, graph)
    sources.append({"group": "heritage-rail", "status": "ok", "count": len(features), "source": str(HERITAGE_PATH.name)})

    print("Drawbridges")
    bridges = drawbridge_features(region_geometries)
    features.extend(bridges)
    sources.append({"group": "drawbridge", "status": "ok", "count": len(bridges), "source": str(DRAWBRIDGE_PATH.name)})

    if args.skip_park_ride:
        sources.append({"group": "park-ride", "status": "skipped", "reason": "--skip-park-ride"})
    else:
        print("Park-and-ride lots")
        lots, lot_sources = park_ride_features(region_geometries)
        features.extend(lots)
        sources.append({"group": "park-ride", "status": "ok", "count": len(lots), "sources": lot_sources})

    if args.skip_ev:
        sources.append({"group": "ev-charging", "status": "skipped", "reason": "--skip-ev"})
    else:
        print("EV charging")
        try:
            stations = ev_features(region_geometries, args.api_key)
            features.extend(stations)
            sources.append({"group": "ev-charging", "status": "ok", "count": len(stations), "source": EV_API})
        except Exception as error:  # noqa: BLE001 - report and continue
            print(f"  ev-charging: SKIPPED ({error})", file=sys.stderr)
            sources.append({"group": "ev-charging", "status": "skipped", "error": str(error)})

    counts = {}
    for feature in features:
        group = feature["properties"]["group"]
        state = feature["properties"].get("state", "?")
        counts.setdefault(group, {"total": 0})
        counts[group]["total"] += 1
        counts[group][state] = counts[group].get(state, 0) + 1

    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "note": "Reference places: heritage railroads, park-and-ride lots, public EV charging, and movable bridges. Nothing here is a live vehicle position.",
            "builtFrom": sources,
            "counts": counts,
            "colors": COLORS,
        },
        "features": features,
    }
    args.output.write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {len(features)} features to {args.output}")
    for group, group_counts in counts.items():
        print(f"  {group}: {json.dumps(group_counts)}")


if __name__ == "__main__":
    main()
