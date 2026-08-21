#!/usr/bin/env python3
"""Audit and optionally repair ferry geometry against authoritative water data.

Coastal land comes from the full-resolution GSHHG shoreline hierarchy. Inland
water comes from Census TIGERweb Areal Hydrography. The default mode is
read-only. ``--repair-manual --write`` replaces only coordinate arrays in the
two checked-in supplemental route catalogs; provider GTFS shapes are never
rewritten by this tool.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import heapq
import json
import math
import pickle
from pathlib import Path
from typing import Iterable

import shapefile
from shapely import contains_xy, disjoint_subset_union_all, make_valid
from shapely.geometry import LineString, Point, box, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
REGIONAL_ROUTES = ROOT / "data" / "regional-routes.geojson"
AUDIT_MANIFEST = ROOT / "scripts" / "ferry-water-audit.json"
SUPPLEMENTAL_FILES = [
    ROOT / "scripts" / "supplemental-routes.json",
    ROOT / "scripts" / "supplemental-ferry-routes.json",
]
NE_BOUNDS = (-75.0, 40.0, -64.0, 48.0)
TERMINAL_OVERRIDES = {
    "isle-au-haut-boat:stonington-town-landing": (
        [-68.660671, 44.154492],
        [-68.639242, 44.073511],
    ),
    "the-cat:bar-harbor-yarmouth": (
        [-68.226595, 44.398203],
        [-66.124527, 43.832948],
    ),
    "thames-river-water-taxi:loop": (
        [-72.0954, 41.3442],
        [-72.088317, 41.387336],
    ),
    "seastreak:providence-bristol-newport": (
        [-71.391, 41.817],
        [-71.3177, 41.489287],
    ),
    "block-island-ferry:newport-block-island": (
        [-71.3177, 41.489287],
        [-71.5558, 41.1733],
    ),
    "jamestown-newport-ferry:hop-on-loop": (
        [-71.369, 41.497],
        [-71.3177, 41.489287],
    ),
    "newport-harbor-shuttle:loop": (
        [-71.3177, 41.489287],
        [-71.3177, 41.489287],
    ),
}
ROUTE_CONTROL_OVERRIDES = {
    # Official Boston Launch stops: Charlestown Marina, New Street,
    # Lewis Mall, and Fan Pier. Coordinates are the waterfront landings,
    # not the street-address centroids.
    "boston-launch:harbor-shuttle": [[
        [-71.049362, 42.374208],
        [-71.0445, 42.370881],
        [-71.042122, 42.365613],
        [-71.043021, 42.354138],
    ]],
}
DROP_COORDINATES = {
    # A stale Portsmouth control sat inland and forced the Star Island path
    # to double back through New Castle. Adjacent audited water controls
    # already describe the channel correctly.
    "isles-of-shoals:portsmouth-star-island": {(-70.721, 43.0605)},
}


def iter_lines(geometry):
    if geometry.geom_type == "LineString":
        yield geometry
    elif geometry.geom_type == "MultiLineString":
        yield from geometry.geoms
    elif geometry.geom_type == "GeometryCollection":
        for part in geometry.geoms:
            yield from iter_lines(part)


class WaterModel:
    def __init__(self, gshhg_dir: Path, hydro_path: Path, gshhg_cache: Path | None = None):
        if gshhg_cache and gshhg_cache.exists():
            self.levels = pickle.loads(gshhg_cache.read_bytes())
        else:
            self.levels = []
            for level in (1, 2, 3, 4):
                reader = shapefile.Reader(str(gshhg_dir / f"GSHHS_f_L{level}.shp"))
                polygons = []
                for record in reader.iterShapeRecords(bbox=NE_BOUNDS):
                    try:
                        geometry = shape(record.shape.__geo_interface__)
                        if not geometry.is_empty:
                            polygons.append(geometry)
                    except Exception:
                        continue
                self.levels.append(polygons)
            if gshhg_cache:
                gshhg_cache.write_bytes(pickle.dumps(self.levels, protocol=5))
        for level, polygons in enumerate(self.levels, 1):
            print(f"GSHHG level {level}: {len(polygons):,} regional polygons", flush=True)
        self.level_trees = [STRtree(polygons) for polygons in self.levels]

        hydro = json.loads(hydro_path.read_text(encoding="utf-8"))
        self.hydro = [make_valid(shape(feature["geometry"])) for feature in hydro["features"]]
        self.hydro_tree = STRtree(self.hydro)
        print(f"Census hydrography: {len(self.hydro):,} polygons", flush=True)

    @staticmethod
    def _query(geometries, tree, bounds_geometry):
        return [geometries[int(index)] for index in tree.query(bounds_geometry)]

    def coastal_land(self, bounds):
        clip = box(*bounds)
        merge = lambda items: disjoint_subset_union_all(items) if items else unary_union([])
        l1 = merge(self._query(self.levels[0], self.level_trees[0], clip))
        l2 = merge(self._query(self.levels[1], self.level_trees[1], clip))
        l3 = merge(self._query(self.levels[2], self.level_trees[2], clip))
        l4 = merge(self._query(self.levels[3], self.level_trees[3], clip))
        return l1.difference(l2).union(l3.difference(l4)).intersection(clip)

    def land_obstacle(self, bounds, hydro_tolerance=0.00018, guide_line=None):
        clip = box(*bounds)
        coastal_land = self.coastal_land(bounds)
        coastal_water_share = 0
        if guide_line is not None and guide_line.length:
            coastal_water_share = guide_line.difference(coastal_land).length / guide_line.length
        # Ocean/harbor routes already have authoritative water from GSHHG.
        # Only pay the much higher hydrography cost when the guide is mostly
        # inside continental land (a lake or river crossing).
        if coastal_water_share < 0.15:
            hydro_parts = self._query(self.hydro, self.hydro_tree, clip)
            hydro = disjoint_subset_union_all(hydro_parts) if hydro_parts else unary_union([])
            if not hydro.is_empty:
                coastal_land = coastal_land.difference(hydro.buffer(hydro_tolerance))
        # Route against the same shoreline used by the final audit. Earlier
        # versions inset this obstacle slightly to keep generalized harbor
        # mouths connected, but that let coast-parallel grid paths accumulate
        # several hundred metres on land. If a narrow entrance is genuinely
        # disconnected at full GSHHG resolution, the repair must fail for
        # manual review instead of manufacturing an almost-water route.
        return coastal_land

    def failing_runs(self, coordinates):
        line = LineString(coordinates)
        minx, miny, maxx, maxy = line.bounds
        pad = 0.002
        coastal_land = self.coastal_land((minx - pad, miny - pad, maxx + pad, maxy + pad))
        dry = line.intersection(coastal_land)
        if not dry.is_empty:
            for hydro in self._query(self.hydro, self.hydro_tree, dry.buffer(0.00018)):
                if hydro.distance(dry) <= 0.00018:
                    dry = dry.difference(hydro.buffer(0.00018))
                    if dry.is_empty:
                        break
        failures = []
        for part in iter_lines(dry):
            length = part.length
            terminal = min(
                part.distance(Point(coordinates[0])),
                part.distance(Point(coordinates[-1])),
            ) < 0.0007
            threshold = 0.0045 if terminal else 0.0018
            if length > threshold:
                failures.append((length, terminal, list(part.coords)[0], list(part.coords)[-1]))
        return failures

    def bad_interior_control(self, coordinate):
        point = Point(coordinate)
        x, y = coordinate
        obstacle = self.land_obstacle((x - 0.012, y - 0.012, x + 0.012, y + 0.012))
        return obstacle.covers(point) and obstacle.boundary.distance(point) > 0.0015

    def route_segment(self, start, end):
        distance = math.dist(start, end)
        initial_margin = max(0.025, min(0.8, distance * 0.45))
        for multiplier in (1, 1.75, 2.75, 5):
            margin = initial_margin * multiplier
            bounds = (
                min(start[0], end[0]) - margin,
                min(start[1], end[1]) - margin,
                max(start[0], end[0]) + margin,
                max(start[1], end[1]) + margin,
            )
            routed = self._route_grid(start, end, bounds, distance)
            if routed:
                return routed
        raise RuntimeError(f"No water path found from {start} to {end}")

    def _route_grid(self, start, end, bounds, distance):
        minx, miny, maxx, maxy = bounds
        if distance > 1.5:
            cell = 0.006
        elif distance > 0.6:
            cell = 0.003
        elif distance > 0.18:
            cell = 0.0015
        elif distance > 0.05:
            cell = 0.00075
        else:
            cell = 0.00035
        width = max(3, math.ceil((maxx - minx) / cell) + 1)
        height = max(3, math.ceil((maxy - miny) / cell) + 1)
        cells = width * height
        if cells > 1_700_000:
            cell *= math.sqrt(cells / 1_700_000)
            width = math.ceil((maxx - minx) / cell) + 1
            height = math.ceil((maxy - miny) / cell) + 1

        obstacle = self.land_obstacle(bounds, guide_line=LineString([start, end]))
        # A point-only raster can place two adjacent open cell centres on
        # opposite sides of a narrow spit. Give land a sub-cell safety margin
        # to suppress those shortcuts while preserving mapped harbor channels;
        # the final exact-vector audit remains the authority.
        if not obstacle.is_empty:
            obstacle = obstacle.buffer(cell * 0.35)
        xs = [minx + column * cell for column in range(width)]
        ys = [miny + row * cell for row in range(height)]
        blocked = bytearray(width * height)
        if not obstacle.is_empty:
            for row, y in enumerate(ys):
                values = contains_xy(obstacle, xs, [y] * width)
                offset = row * width
                for column, value in enumerate(values):
                    blocked[offset + column] = bool(value)

        def node(point):
            column = min(width - 1, max(0, round((point[0] - minx) / cell)))
            row = min(height - 1, max(0, round((point[1] - miny) / cell)))
            return column, row

        def open_node(origin):
            if not blocked[origin[1] * width + origin[0]]:
                return origin
            for radius in range(1, max(width, height)):
                candidates = []
                for column in range(max(0, origin[0] - radius), min(width, origin[0] + radius + 1)):
                    candidates.extend(((column, origin[1] - radius), (column, origin[1] + radius)))
                for row in range(max(0, origin[1] - radius + 1), min(height, origin[1] + radius)):
                    candidates.extend(((origin[0] - radius, row), (origin[0] + radius, row)))
                valid = [
                    item for item in candidates
                    if 0 <= item[0] < width and 0 <= item[1] < height
                    and not blocked[item[1] * width + item[0]]
                ]
                if valid:
                    return min(valid, key=lambda item: math.dist(item, origin))
            return None

        source = open_node(node(start))
        target = open_node(node(end))
        if source is None or target is None:
            return None

        moves = ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1),
                 (1, 1, math.sqrt(2)), (1, -1, math.sqrt(2)),
                 (-1, 1, math.sqrt(2)), (-1, -1, math.sqrt(2)))
        queue = [(math.dist(source, target), 0.0, source)]
        costs = {source: 0.0}
        parents = {}
        while queue:
            _, cost, current = heapq.heappop(queue)
            if cost != costs.get(current):
                continue
            if current == target:
                break
            for dx, dy, move_cost in moves:
                nxt = (current[0] + dx, current[1] + dy)
                if not (0 <= nxt[0] < width and 0 <= nxt[1] < height):
                    continue
                if blocked[nxt[1] * width + nxt[0]]:
                    continue
                if dx and dy:
                    if blocked[current[1] * width + nxt[0]] or blocked[nxt[1] * width + current[0]]:
                        continue
                new_cost = cost + move_cost
                if new_cost >= costs.get(nxt, math.inf):
                    continue
                costs[nxt] = new_cost
                parents[nxt] = current
                priority = new_cost + math.dist(nxt, target)
                heapq.heappush(queue, (priority, new_cost, nxt))
        if target not in costs:
            return None

        grid_path = [target]
        while grid_path[-1] != source:
            grid_path.append(parents[grid_path[-1]])
        grid_path.reverse()
        grid_coordinates = [[xs[column], ys[row]] for column, row in grid_path]
        # Keep the grid vertices. Generic line simplification is unsafe here:
        # even a small tolerance can shortcut across a peninsula or island.
        coordinates = [start, *grid_coordinates, end]
        deduped = [coordinates[0]]
        for coordinate in coordinates[1:]:
            if math.dist(coordinate, deduped[-1]) > cell * 0.05:
                deduped.append(coordinate)
        return [[round(x, 6), round(y, 6)] for x, y in deduped]


def repair_path(model, coordinates):
    if not model.failing_runs(coordinates):
        return coordinates, False
    # A previous routing pass may already contain hundreds of regular grid
    # vertices. Collapse those into coarse candidate controls first; every
    # simplified segment is then rechecked and any land-cutting shortcut is
    # replaced with a fresh water-grid path below.
    candidates = coordinates
    if len(coordinates) > 8:
        candidates = list(LineString(coordinates).simplify(0.0015, preserve_topology=False).coords)
    candidate_line = LineString(candidates)
    minx, miny, maxx, maxy = candidate_line.bounds
    route_obstacle = model.land_obstacle(
        (minx - 0.003, miny - 0.003, maxx + 0.003, maxy + 0.003),
        guide_line=candidate_line,
    )
    controls = [candidates[0]]
    controls.extend(
        coordinate for coordinate in candidates[1:-1]
        if not (
            route_obstacle.covers(Point(coordinate))
            and route_obstacle.boundary.distance(Point(coordinate)) > 0.0015
        )
    )
    controls.append(candidates[-1])
    repaired = [coordinates[0]]
    changed = len(controls) != len(coordinates)
    for start, end in zip(controls, controls[1:]):
        land_length = LineString([start, end]).intersection(route_obstacle).length
        if land_length > 0.0002:
            print(f"  routing water gap {start} -> {end}", flush=True)
            routed = model.route_segment(start, end)
            repaired.extend(routed[1:])
            changed = True
        else:
            repaired.append(end)
    return repaired, changed


def route_id(feature):
    return feature.get("properties", {}).get("route", "unknown")


def audit_collection(model, collection):
    failures = []
    ferries = [f for f in collection["features"] if f.get("properties", {}).get("group") == "ferry"]
    for feature in ferries:
        geometry = feature["geometry"]
        paths = geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]]
        runs = [run for path in paths for run in model.failing_runs(path)]
        if runs:
            longest = max(runs, key=lambda run: run[0])
            failures.append((longest[0], route_id(feature), len(runs), longest[1], longest[2], longest[3]))
    return ferries, sorted(failures, reverse=True)


def write_manifest(ferries, path):
    def canonical_coordinates(value):
        if (isinstance(value, list) and len(value) == 2
                and all(isinstance(item, (int, float)) for item in value)):
            return f"{float(value[0]):.6f},{float(value[1]):.6f}"
        return "[" + "|".join(canonical_coordinates(item) for item in value) + "]"

    entries = {}
    for feature in sorted(ferries, key=route_id):
        identifier = route_id(feature)
        if identifier in entries:
            raise RuntimeError(f"Duplicate ferry route id cannot be audited: {identifier}")
        payload = canonical_coordinates(feature["geometry"]["coordinates"])
        entries[identifier] = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    document = {
        "auditVersion": "gshhg-census-water-v1",
        "reviewedAt": datetime.date.today().isoformat(),
        "routeCount": len(entries),
        "geometrySha256": entries,
        "sources": [
            "GSHHG full-resolution shoreline hierarchy",
            "U.S. Census TIGERweb Areal Hydrography",
        ],
    }
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {len(entries)} audited ferry fingerprints to {path}")


def repair_manual_files(model, write, only_routes=None):
    total = 0
    errors = []
    for path in SUPPLEMENTAL_FILES:
        raw = path.read_text(encoding="utf-8")
        document = json.loads(raw)
        replacements = []
        for feature in document["features"]:
            if feature.get("properties", {}).get("group") != "ferry":
                continue
            if only_routes and route_id(feature) not in only_routes:
                continue
            geometry = feature["geometry"]
            print(f"Checking {route_id(feature)}", flush=True)
            old_coordinates = geometry["coordinates"]
            old_paths = old_coordinates if geometry["type"] == "MultiLineString" else [old_coordinates]
            identifier = route_id(feature)
            candidate_paths = json.loads(json.dumps(
                ROUTE_CONTROL_OVERRIDES.get(identifier, old_paths)
            ))
            drops = DROP_COORDINATES.get(identifier, set())
            if drops:
                candidate_paths = [
                    [coordinate for coordinate in path if tuple(coordinate) not in drops]
                    for path in candidate_paths
                ]
            override = TERMINAL_OVERRIDES.get(route_id(feature))
            if override:
                candidate_paths[0][0] = override[0]
                candidate_paths[-1][-1] = override[1]
            new_paths = []
            changed = candidate_paths != old_paths
            try:
                for coordinates in candidate_paths:
                    repaired, path_changed = repair_path(model, coordinates)
                    new_paths.append(repaired)
                    changed = changed or path_changed
            except RuntimeError as error:
                errors.append(f"{route_id(feature)}: {error}")
                print(f"  unable to repair: {error}", flush=True)
                continue
            if not changed:
                continue
            new_coordinates = new_paths if geometry["type"] == "MultiLineString" else new_paths[0]
            old_json = json.dumps(old_coordinates, separators=(",", ":"))
            new_json = json.dumps(new_coordinates, separators=(",", ":"))
            if old_json not in raw:
                raise RuntimeError(f"Coordinate array for {route_id(feature)} was not found verbatim in {path}")
            replacements.append((old_json, new_json, route_id(feature)))
        print(f"{path.name}: {len(replacements)} routes need repair")
        if write:
            for old_json, new_json, identifier in replacements:
                count = raw.count(old_json)
                if count < 1:
                    raise RuntimeError(f"Coordinate array for {identifier} disappeared before write")
                # Identical paths can legitimately appear in two catalog
                # entries. Replacements are collected in source order, so the
                # first remaining occurrence belongs to the current feature.
                raw = raw.replace(old_json, new_json, 1)
            path.write_text(raw, encoding="utf-8", newline="")
        total += len(replacements)
    if errors:
        raise RuntimeError("Unrepaired ferry paths:\n  " + "\n  ".join(errors))
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gshhg-dir", type=Path, required=True)
    parser.add_argument("--gshhg-cache", type=Path)
    parser.add_argument("--hydro", type=Path, required=True)
    parser.add_argument("--repair-manual", action="store_true")
    parser.add_argument(
        "--route",
        action="append",
        help="Limit manual repair to a route id; repeat for multiple routes",
    )
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--write-manifest", action="store_true")
    args = parser.parse_args()
    if args.write and not args.repair_manual:
        parser.error("--write requires --repair-manual")

    model = WaterModel(args.gshhg_dir, args.hydro, args.gshhg_cache)
    if args.repair_manual:
        changed = repair_manual_files(model, args.write, set(args.route or []))
        print(f"{'Repaired' if args.write else 'Would repair'} {changed} supplemental ferry routes")
        return

    collection = json.loads(REGIONAL_ROUTES.read_text(encoding="utf-8"))
    ferries, failures = audit_collection(model, collection)
    for length, identifier, run_count, terminal, start, end in failures:
        location = f"{start[0]:.5f},{start[1]:.5f} -> {end[0]:.5f},{end[1]:.5f}"
        print(
            f"FAIL {identifier}: {length * 82:.2f} km longest land run "
            f"({run_count} runs; {'terminal' if terminal else 'interior'}; {location})"
        )
    print(f"Audited {len(ferries)} ferry routes; {len(failures)} failed")
    if args.write_manifest and not failures:
        write_manifest(ferries, AUDIT_MANIFEST)
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
