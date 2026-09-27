"""OpenStreetMap water model, audit rules, and repair for ferry geometry.

Used by ``build-regional-routes.py --update-ferry-cache`` and
``audit-ferry-water.py``. Normal (offline) builds never import this module;
they read ``scripts/ferry-water-cache.json`` instead, so shapely/scipy and the
~16 MB local water model are only needed by maintainers refreshing the cache.

Land model: OSM coastline land polygons minus OSM inland water polygons
(lakes, riverbanks, docks), both fetched by ``fetch-ferry-audit-data.py``.

Audit rules (``AUDIT_VERSION``):
  * no interior dry run longer than 25 m;
  * no dry run within 300 m of either endpoint longer than 150 m (landings sit
    on piers, and the coastline closes across some harbor mouths);
  * no self-intersecting path part;
  * each path is > 0.15 km and at least 0.95 x its terminal-to-terminal distance.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
import shapely
from shapely import make_valid
from shapely.geometry import LineString, MultiLineString, Point, box
from shapely.ops import linemerge, unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
WATER_DIR = ROOT / ".codex-research" / "water-audit"
LAND_PATH = WATER_DIR / "osm-land-ne.wkb.json"
WATER_PATH = WATER_DIR / "osm-inland-water-ne.wkb.json"
FERRY_WAYS_PATH = WATER_DIR / "osm-ferry-ways.json"

AUDIT_VERSION = "osm-land-v3"
MAX_INTERIOR_DRY_M = 25.0
MAX_ENDPOINT_DRY_M = 150.0
ENDPOINT_ZONE_M = 300.0
MIN_LENGTH_KM = 0.15
MIN_LENGTH_RATIO = 0.95
OSM_MATCH_KM = 1.5

TILE = 0.05
REPAIR_TRIGGER_M = 8.0      # repair interior dry runs above this (rule is 25 m)
CLEARANCE_M = 45.0          # preferred distance from shore for repaired/pulled paths
M_PER_DEG_LAT = 110_574.0


def m_per_deg_lon(lat):
    return 111_320.0 * math.cos(math.radians(lat))


def haversine_km(start, end):
    lon1, lat1 = map(math.radians, start)
    lon2, lat2 = map(math.radians, end)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(value))


def polyline_km(points):
    return sum(haversine_km(a, b) for a, b in zip(points, points[1:]))


def line_m(geometry):
    total = 0.0
    for part in iter_lines(geometry):
        coords = list(part.coords)
        total += polyline_km(coords) * 1000
    return total


def iter_lines(geometry):
    if geometry is None or geometry.is_empty:
        return
    kind = geometry.geom_type
    if kind == "LineString":
        yield geometry
    elif kind in {"MultiLineString", "GeometryCollection"}:
        for part in geometry.geoms:
            yield from iter_lines(part)


def canonical_coordinates(value):
    if (isinstance(value, (list, tuple)) and len(value) == 2
            and all(isinstance(item, (int, float)) for item in value)):
        return f"{float(value[0]):.6f},{float(value[1]):.6f}"
    return "[" + "|".join(canonical_coordinates(item) for item in value) + "]"


def geometry_sha256(coordinates):
    return hashlib.sha256(canonical_coordinates(coordinates).encode("utf-8")).hexdigest()


def load_wkb(path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    geometries = shapely.from_wkb([base64.b64decode(item) for item in payload["wkb"]])
    return list(geometries), payload.get("metadata", {})


class WaterModel:
    """Effective land = OSM land polygons minus OSM inland water, tiled."""

    def __init__(self, land_path=LAND_PATH, water_path=WATER_PATH):
        if not land_path.exists() or not water_path.exists():
            raise FileNotFoundError(
                "Ferry water model is missing. Run: py -3 -X utf8 scripts/fetch-ferry-audit-data.py"
            )
        self.land, self.land_metadata = load_wkb(land_path)
        self.water, self.water_metadata = load_wkb(water_path)
        self.land_tree = STRtree(self.land)
        self.water_tree = STRtree(self.water)
        self._tiles = {}

    def describe(self):
        return {
            "auditVersion": AUDIT_VERSION,
            "land": f"{self.land_metadata.get('source')} fetched {self.land_metadata.get('fetchedAt')}",
            "inlandWater": f"{self.water_metadata.get('source')} fetched {self.water_metadata.get('fetchedAt')}",
        }

    def tile(self, ix, iy):
        key = (ix, iy)
        cached = self._tiles.get(key)
        if cached is not None:
            return cached
        clip = box(ix * TILE, iy * TILE, (ix + 1) * TILE, (iy + 1) * TILE)
        land = [self.land[i] for i in self.land_tree.query(clip, predicate="intersects")]
        if land:
            geometry = unary_union([shapely.clip_by_rect(item, *clip.bounds) for item in land])
            water = [self.water[i] for i in self.water_tree.query(clip, predicate="intersects")]
            if water and not geometry.is_empty:
                water_union = unary_union([make_valid(shapely.clip_by_rect(item, *clip.bounds)) for item in water])
                geometry = geometry.difference(water_union)
            geometry = make_valid(geometry)
            polygons = [part for part in getattr(geometry, "geoms", [geometry]) if part.geom_type in {"Polygon", "MultiPolygon"}]
            geometry = unary_union(polygons) if polygons else shapely.Polygon()
        else:
            geometry = shapely.Polygon()
        if not geometry.is_empty:
            shapely.prepare(geometry)
        self._tiles[key] = geometry
        return geometry

    def tiles_for_bounds(self, minx, miny, maxx, maxy):
        for ix in range(math.floor(minx / TILE), math.floor(maxx / TILE) + 1):
            for iy in range(math.floor(miny / TILE), math.floor(maxy / TILE) + 1):
                yield ix, iy

    def tiles_for_line(self, line):
        seen = set()
        coords = list(line.coords)
        for a, b in zip(coords, coords[1:]):
            steps = max(1, math.ceil(math.dist(a, b) / (TILE / 3)))
            for step in range(steps + 1):
                x = a[0] + (b[0] - a[0]) * step / steps
                y = a[1] + (b[1] - a[1]) * step / steps
                for ix in (math.floor((x - 1e-4) / TILE), math.floor((x + 1e-4) / TILE)):
                    for iy in (math.floor((y - 1e-4) / TILE), math.floor((y + 1e-4) / TILE)):
                        seen.add((ix, iy))
        return seen

    def dry_geometry(self, line):
        parts = []
        for ix, iy in self.tiles_for_line(line):
            land = self.tile(ix, iy)
            if land.is_empty or not land.intersects(line):
                continue
            clipped = shapely.clip_by_rect(line, ix * TILE, iy * TILE, (ix + 1) * TILE, (iy + 1) * TILE)
            if clipped.is_empty:
                continue
            parts.extend(iter_lines(clipped.intersection(land)))
        if not parts:
            return []
        union = unary_union(parts)
        if union.geom_type == "MultiLineString":
            union = linemerge(union)
        return list(iter_lines(union))

    def segment_dry_m(self, a, b):
        if a == b:
            return 0.0
        return sum(line_m(part) for part in self.dry_geometry(LineString([a, b])))

    def segment_is_wet(self, a, b):
        line = LineString([a, b])
        for ix, iy in self.tiles_for_line(line):
            land = self.tile(ix, iy)
            if not land.is_empty and land.intersects(line):
                clipped = shapely.clip_by_rect(line, ix * TILE, iy * TILE, (ix + 1) * TILE, (iy + 1) * TILE)
                if not clipped.is_empty and clipped.intersection(land).length > 1e-9:
                    return False
        return True

    def point_is_land(self, point):
        land = self.tile(math.floor(point[0] / TILE), math.floor(point[1] / TILE))
        return not land.is_empty and land.contains(Point(point))

    def rasterize(self, minx, miny, maxx, maxy, cell_m):
        lat0 = (miny + maxy) / 2
        dx = cell_m / m_per_deg_lon(lat0)
        dy = cell_m / M_PER_DEG_LAT
        width = int(math.ceil((maxx - minx) / dx)) + 1
        height = int(math.ceil((maxy - miny) / dy)) + 1
        xs = minx + np.arange(width) * dx
        ys = miny + np.arange(height) * dy
        land = np.zeros((height, width), dtype=bool)
        for ix, iy in self.tiles_for_bounds(minx, miny, maxx, maxy):
            geometry = self.tile(ix, iy)
            if geometry.is_empty:
                continue
            c0 = np.searchsorted(xs, ix * TILE)
            c1 = np.searchsorted(xs, (ix + 1) * TILE)
            r0 = np.searchsorted(ys, iy * TILE)
            r1 = np.searchsorted(ys, (iy + 1) * TILE)
            if c0 >= c1 or r0 >= r1:
                continue
            gx, gy = np.meshgrid(xs[c0:c1], ys[r0:r1])
            land[r0:r1, c0:c1] |= shapely.contains_xy(geometry, gx, gy)
        return land, xs, ys, dx, dy


# ---------------------------------------------------------------- audit


def path_metrics(model, path):
    """Dry-run metrics for one coordinate path (list of [lon, lat])."""
    line = LineString(path)
    start, end = Point(path[0]), Point(path[-1])
    lat0 = (path[0][1] + path[-1][1]) / 2
    zone_deg = ENDPOINT_ZONE_M / M_PER_DEG_LAT
    interior = 0.0
    endpoint = 0.0
    runs = []
    for part in model.dry_geometry(line):
        length = line_m(part)
        near = min(part.distance(start), part.distance(end))
        # distance() is in degrees; convert with the smaller metre scale so
        # the endpoint zone is never overstated.
        near_m = near * min(M_PER_DEG_LAT, m_per_deg_lon(lat0))
        is_endpoint = near_m <= ENDPOINT_ZONE_M
        runs.append({"m": length, "endpoint": is_endpoint, "from": list(part.coords)[0], "to": list(part.coords)[-1]})
        if is_endpoint:
            endpoint = max(endpoint, length)
        else:
            interior = max(interior, length)
    del zone_deg
    length_km = polyline_km(path)
    direct_km = haversine_km(path[0], path[-1])
    simple = LineString(path).is_simple if len(path) >= 2 else True
    return {
        "interiorDryM": round(interior, 1),
        "endpointDryM": round(endpoint, 1),
        "selfIntersects": not simple,
        "lengthKm": round(length_km, 3),
        "directKm": round(direct_km, 3),
        "runs": runs,
    }


def path_failures(metrics, loop=False):
    failures = []
    if metrics["interiorDryM"] > MAX_INTERIOR_DRY_M:
        failures.append(f"interior dry run {metrics['interiorDryM']:.0f} m")
    if metrics["endpointDryM"] > MAX_ENDPOINT_DRY_M:
        failures.append(f"endpoint dry run {metrics['endpointDryM']:.0f} m")
    if metrics["selfIntersects"]:
        failures.append("self-intersecting path")
    if metrics["lengthKm"] <= MIN_LENGTH_KM:
        failures.append(f"path only {metrics['lengthKm']:.3f} km long")
    if metrics["lengthKm"] < MIN_LENGTH_RATIO * metrics["directKm"] - 1e-6:
        failures.append("path shorter than its terminal distance")
    return failures


def audit_paths(model, paths):
    per_path = [path_metrics(model, path) for path in paths]
    failures = []
    for index, metrics in enumerate(per_path):
        failures.extend(f"path {index}: {item}" for item in path_failures(metrics))
    return {
        "interiorDryM": max((m["interiorDryM"] for m in per_path), default=0.0),
        "endpointDryM": max((m["endpointDryM"] for m in per_path), default=0.0),
        "selfIntersects": any(m["selfIntersects"] for m in per_path),
        "lengthKm": round(sum(m["lengthKm"] for m in per_path), 3),
        "directKm": round(sum(m["directKm"] for m in per_path), 3),
        "failures": failures,
        "paths": per_path,
    }


# ---------------------------------------------------------------- routing


def grid_route(model, start, end, window, cell_m, clearance_m=CLEARANCE_M):
    """Least-cost water path on a raster; returns [lon, lat] list or None."""
    minx, miny, maxx, maxy = window
    land, xs, ys, dx, dy = model.rasterize(minx, miny, maxx, maxy, cell_m)
    height, width = land.shape
    water = ~land
    if not water.any():
        return None
    distance = ndimage.distance_transform_edt(water) * cell_m
    penalty = np.clip((clearance_m * 2 - distance) / (clearance_m * 2), 0, 1) * 4.0

    def nearest_water(point):
        column = int(round((point[0] - minx) / dx))
        row = int(round((point[1] - miny) / dy))
        column = min(width - 1, max(0, column))
        row = min(height - 1, max(0, row))
        if water[row, column]:
            return row, column
        radius = int(math.ceil(400 / cell_m))
        r0, r1 = max(0, row - radius), min(height, row + radius + 1)
        c0, c1 = max(0, column - radius), min(width, column + radius + 1)
        sub = water[r0:r1, c0:c1]
        if not sub.any():
            return None
        rr, cc = np.nonzero(sub)
        best = np.argmin((rr + r0 - row) ** 2 + (cc + c0 - column) ** 2)
        return int(rr[best] + r0), int(cc[best] + c0)

    source = nearest_water(start)
    target = nearest_water(end)
    if source is None or target is None:
        return None
    index = np.arange(height * width).reshape(height, width)
    rows, cols, weights = [], [], []
    for drow, dcol, step in ((0, 1, 1.0), (1, 0, 1.0), (1, 1, math.sqrt(2)), (1, -1, math.sqrt(2))):
        r_a = slice(0, height - drow)
        r_b = slice(drow, height)
        c_a = slice(max(0, -dcol), width - max(0, dcol))
        c_b = slice(max(0, dcol), width + min(0, dcol))
        ok = water[r_a, c_a] & water[r_b, c_b]
        if drow and dcol:
            # no diagonal corner cutting between two land cells
            ok &= water[r_a, c_b] & water[r_b, c_a]
        a_idx = index[r_a, c_a][ok]
        b_idx = index[r_b, c_b][ok]
        cost = step * cell_m * (1 + 0.5 * (penalty[r_a, c_a][ok] + penalty[r_b, c_b][ok]))
        rows.extend([a_idx, b_idx])
        cols.extend([b_idx, a_idx])
        weights.extend([cost, cost])
    graph = coo_matrix(
        (np.concatenate(weights), (np.concatenate(rows), np.concatenate(cols))),
        shape=(height * width, height * width),
    ).tocsr()
    src = int(index[source])
    dst = int(index[target])
    dist, predecessors = dijkstra(graph, indices=src, return_predecessors=True, limit=np.inf)
    if not math.isfinite(dist[dst]):
        return None
    chain = [dst]
    while chain[-1] != src:
        chain.append(int(predecessors[chain[-1]]))
        if chain[-1] < 0:
            return None
    chain.reverse()
    coords = [[float(xs[i % width]), float(ys[i // width])] for i in chain]
    return [list(start), *coords, list(end)]


def route_between(model, start, end, cell_m=None):
    """Water path between two points, widening the search window as needed."""
    lat0 = (start[1] + end[1]) / 2
    span_m = haversine_km(start, end) * 1000
    base_cell = cell_m or min(120.0, max(15.0, span_m / 350))
    for grow in (1.0, 2.0, 4.0, 8.0):
        margin_m = max(1500.0, span_m * 0.35) * grow
        mx = margin_m / m_per_deg_lon(lat0)
        my = margin_m / M_PER_DEG_LAT
        window = (min(start[0], end[0]) - mx, min(start[1], end[1]) - my,
                  max(start[0], end[0]) + mx, max(start[1], end[1]) + my)
        width_m = (window[2] - window[0]) * m_per_deg_lon(lat0)
        height_m = (window[3] - window[1]) * M_PER_DEG_LAT
        cell = max(base_cell, math.sqrt(width_m * height_m / 1_500_000))
        routed = grid_route(model, start, end, window, cell)
        if routed:
            return routed
        # a finer grid can open a narrow channel the coarse one closed
        if cell > 20:
            routed = grid_route(model, start, end, window, max(12.0, cell / 2.5))
            if routed:
                return routed
    return None


# ---------------------------------------------------------------- smoothing


class Validator:
    """Segment acceptance against land, with endpoint allowances."""

    def __init__(self, model, path):
        self.model = model
        self.start = tuple(path[0])
        self.end = tuple(path[-1])
        self._memo = {}

    def near_endpoint(self, point, metres=ENDPOINT_ZONE_M):
        return (haversine_km(point, self.start) * 1000 <= metres
                or haversine_km(point, self.end) * 1000 <= metres)

    def ok(self, a, b, allowance_m=0.0):
        key = (tuple(a), tuple(b), allowance_m)
        if key in self._memo:
            return self._memo[key]
        if allowance_m <= 0:
            result = self.model.segment_is_wet(a, b)
        else:
            result = self.model.segment_dry_m(a, b) <= allowance_m
        self._memo[key] = result
        return result


def string_pull(model, path, pinned):
    """Greedy any-angle shortcutting: keep the farthest visible vertex.

    A shortcut is accepted when it adds no dry length relative to the path it
    replaces. Pinned vertices (stops, sharp reversals) are never skipped.
    """
    if len(path) <= 2:
        return path
    validator = Validator(model, path)
    seg_dry = [model.segment_dry_m(a, b) for a, b in zip(path, path[1:])]
    cum = [0.0]
    for value in seg_dry:
        cum.append(cum[-1] + value)
    result = [path[0]]
    i = 0
    n = len(path)
    while i < n - 1:
        limit = n - 1
        for p in sorted(pinned):
            if p > i:
                limit = min(limit, p)
                break

        def good(j):
            existing = cum[j] - cum[i]
            if existing <= 0.5:
                return validator.ok(path[i], path[j])
            return model.segment_dry_m(path[i], path[j]) <= existing + 0.5

        best = i + 1
        step = 1
        j = i + 1
        # exponential probe then binary refine (visibility is near-monotone)
        while j <= limit:
            if good(j):
                best = j
                step *= 2
                j = i + step
            else:
                break
        lo, hi = best, min(limit, i + step)
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if good(mid):
                lo = mid
            else:
                hi = mid
        if hi != lo and hi <= limit and good(hi):
            lo = hi
        best = max(best, lo)
        result.append(path[best])
        i = best
    return result


def chaikin(model, path, iterations=2, pinned_points=()):
    pinned = {tuple(point) for point in pinned_points}
    validator = Validator(model, path)
    for _ in range(iterations):
        if len(path) < 3:
            return path
        output = [path[0]]
        for k in range(1, len(path) - 1):
            prev, cur, nxt = path[k - 1], path[k], path[k + 1]
            if tuple(cur) in pinned:
                output.append(cur)
                continue
            q = [0.75 * cur[0] + 0.25 * prev[0], 0.75 * cur[1] + 0.25 * prev[1]]
            r = [0.75 * cur[0] + 0.25 * nxt[0], 0.75 * cur[1] + 0.25 * nxt[1]]
            if validator.ok(q, r):
                output.extend([q, r])
            else:
                output.append(cur)
        output.append(path[-1])
        path = output
    return path


def water_simplify(model, path, tolerance_m, pinned_points=()):
    """Douglas-Peucker that only accepts shortcuts adding no dry length."""
    if len(path) <= 2:
        return path
    pinned = {tuple(point) for point in pinned_points}
    lat0 = sum(p[1] for p in path) / len(path)
    sx, sy = m_per_deg_lon(lat0), M_PER_DEG_LAT
    seg_dry = [model.segment_dry_m(a, b) for a, b in zip(path, path[1:])]
    cum = [0.0]
    for value in seg_dry:
        cum.append(cum[-1] + value)

    def deviation(point, a, b):
        px, py = point[0] * sx, point[1] * sy
        ax, ay, bx, by = a[0] * sx, a[1] * sy, b[0] * sx, b[1] * sy
        vx, vy = bx - ax, by - ay
        denom = vx * vx + vy * vy
        t = 0 if denom == 0 else max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / denom))
        return math.hypot(px - ax - t * vx, py - ay - t * vy)

    keep = [False] * len(path)
    keep[0] = keep[-1] = True
    for index, point in enumerate(path):
        if tuple(point) in pinned:
            keep[index] = True
    stack = [(0, len(path) - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        inner_pins = [k for k in range(i + 1, j) if keep[k] and tuple(path[k]) in pinned]
        if inner_pins:
            k = inner_pins[0]
            stack.extend([(i, k), (k, j)])
            continue
        index, worst = max(((k, deviation(path[k], path[i], path[j])) for k in range(i + 1, j)), key=lambda kv: kv[1])
        existing = cum[j] - cum[i]
        if worst <= tolerance_m:
            if existing <= 0.5:
                accepted = model.segment_is_wet(path[i], path[j])
            else:
                accepted = model.segment_dry_m(path[i], path[j]) <= existing + 0.5
            if accepted:
                continue
        keep[index] = True
        stack.extend([(i, index), (index, j)])
    return [point for point, flag in zip(path, keep) if flag]


def dedupe(path, min_m=1.0):
    output = [path[0]]
    for point in path[1:]:
        if haversine_km(point, output[-1]) * 1000 >= min_m:
            output.append(point)
    if len(output) == 1 and len(path) > 1:
        output.append(path[-1])
    output[-1] = path[-1]
    return output


def rounded(path):
    return [[round(float(x), 6), round(float(y), 6)] for x, y in path]


# ---------------------------------------------------------------- repair


def densify(path, step_m=60.0):
    output = [list(path[0])]
    for a, b in zip(path, path[1:]):
        length = haversine_km(a, b) * 1000
        steps = max(1, math.ceil(length / step_m))
        for k in range(1, steps + 1):
            output.append([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps])
    return output


def wet_index(model, dense, index, direction, min_clear_steps=2):
    """First index from ``index`` in ``direction`` whose vertex is in water."""
    k = index
    clear = 0
    while 0 < k < len(dense) - 1:
        if not model.point_is_land(dense[k]):
            clear += 1
            if clear >= min_clear_steps:
                return k
        else:
            clear = 0
        k += direction
    return k


def repair_path(model, path, pinned_points=()):
    """Replace interior dry runs with least-cost water detours.

    Returns (new_path, changed). Endpoints are preserved exactly.
    """
    changed = False
    for _attempt in range(6):
        metrics = path_metrics(model, path)
        bad = [run for run in metrics["runs"]
               if (not run["endpoint"] and run["m"] > REPAIR_TRIGGER_M)
               or (run["endpoint"] and run["m"] > MAX_ENDPOINT_DRY_M * 0.8)]
        if not bad:
            break
        dense = densify(path)
        land_flags = [model.point_is_land(p) for p in dense]
        # dry vertex groups in the densified path
        groups = []
        k = 0
        while k < len(dense):
            if land_flags[k]:
                g0 = k
                while k < len(dense) and land_flags[k]:
                    k += 1
                groups.append((g0, k - 1))
            else:
                k += 1
        if not groups:
            # Dry runs between samples (thin spits): densify further.
            dense = densify(path, 15.0)
            land_flags = [model.point_is_land(p) for p in dense]
            k = 0
            while k < len(dense):
                if land_flags[k]:
                    g0 = k
                    while k < len(dense) and land_flags[k]:
                        k += 1
                    groups.append((g0, k - 1))
                else:
                    k += 1
            if not groups:
                break
        # Merge groups that are close together so one detour covers them.
        merged = []
        for g in groups:
            if merged and g[0] - merged[-1][1] <= 8:
                merged[-1] = (merged[-1][0], g[1])
            else:
                merged.append(g)
        output = []
        cursor = 0
        for g0, g1 in merged:
            a = max(0, g0 - 3)
            b = min(len(dense) - 1, g1 + 3)
            a = wet_index(model, dense, a, -1) if a > 0 else 0
            b = wet_index(model, dense, b, +1) if b < len(dense) - 1 else len(dense) - 1
            if a < cursor:
                continue
            routed = route_between(model, dense[a], dense[b])
            if not routed:
                raise RuntimeError(f"no water path between {rounded([dense[a]])[0]} and {rounded([dense[b]])[0]}")
            routed = string_pull(model, routed, set())
            output.extend(dense[cursor:a])
            output.extend(routed)
            cursor = b + 1
            changed = True
        output.extend(dense[cursor:])
        path = dedupe(output, 0.5)
        path[0], path[-1] = list(path[0]), list(path[-1])
    return path, changed


def pinned_indexes(path, landings, pin_radius_m=120.0):
    pins = set()
    for index, point in enumerate(path[1:-1], 1):
        prev, nxt = path[index - 1], path[index + 1]
        v1 = (point[0] - prev[0], point[1] - prev[1])
        v2 = (nxt[0] - point[0], nxt[1] - point[1])
        n1, n2 = math.hypot(*v1), math.hypot(*v2)
        if n1 and n2:
            cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)
            if cos < math.cos(math.radians(135)) and min(n1, n2) * M_PER_DEG_LAT > 40:
                pins.add(index)
                continue
        for landing in landings:
            if haversine_km(point, landing) * 1000 <= pin_radius_m:
                pins.add(index)
                break
    return pins


def clean_path(model, path, landings, mode):
    """Repair and smooth one path.

    mode: 'keep' (a passing operator/OSM geometry: light water-safe trim),
          'pull' (hand or repaired geometry: string-pull, smooth, trim).
    """
    path = rounded(dedupe([list(p) for p in path], 0.5))
    if len(path) < 2:
        return path
    repaired, changed = repair_path(model, path)
    if mode == "keep" and not changed:
        return rounded(water_simplify(model, path, 5.0))
    path = repaired
    # Pin intermediate landings (vertices near a known landing that are local
    # turning points) so smoothing never skips a stop.
    local_landings = [
        landing for landing in landings
        if haversine_km(landing, path[0]) * 1000 > 200 and haversine_km(landing, path[-1]) * 1000 > 200
    ]
    pins = pinned_indexes(path, local_landings)
    pulled = string_pull(model, path, pins)
    pin_points = [path[i] for i in pins]
    smooth = chaikin(model, pulled, 3, pin_points)
    final = water_simplify(model, smooth, 6.0, pin_points)
    return rounded(dedupe(final, 1.0))


def split_at_self_intersections(path, pinned_points):
    """Split a path into as few simple parts as possible.

    Out-and-back calls at intermediate landings make a path cross or retrace
    itself. Cuts are made only at pinned stop vertices, greedily extending
    each part for as long as it stays simple.
    """
    if len(path) < 3 or LineString(path).is_simple:
        return [path]
    pinned = {tuple(p) for p in pinned_points}
    parts = []
    start = 0
    last_cut = None
    k = start + 2
    while k < len(path):
        if not LineString(path[start:k + 1]).is_simple:
            cut = last_cut if last_cut is not None and last_cut > start else k - 1
            parts.append(path[start:cut + 1])
            start = cut
            last_cut = None
            k = start + 2
            continue
        if tuple(path[k]) in pinned:
            last_cut = k
        k += 1
    parts.append(path[start:])
    return [part for part in parts if len(part) >= 2]


# ---------------------------------------------------------------- OSM ways


class OsmFerryWays:
    def __init__(self, path=FERRY_WAYS_PATH):
        payload = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"elements": []}
        self.ways = {}
        for element in payload.get("elements", []):
            coords = [[node["lon"], node["lat"]] for node in element.get("geometry", [])]
            if len(coords) >= 2:
                self.ways[element["id"]] = {"coords": coords, "name": element.get("tags", {}).get("name", "")}

    def chain(self, way_ids, start=None):
        """Join the listed ways end-to-end (any orientation)."""
        remaining = [list(self.ways[w]["coords"]) for w in way_ids if w in self.ways]
        if len(remaining) != len(way_ids):
            return None
        path = remaining.pop(0)
        if start is not None and haversine_km(path[-1], start) < haversine_km(path[0], start):
            path.reverse()
        while remaining:
            best = None
            for index, candidate in enumerate(remaining):
                for flip in (False, True):
                    c = candidate[::-1] if flip else candidate
                    gap = haversine_km(path[-1], c[0])
                    if best is None or gap < best[0]:
                        best = (gap, index, c)
            if best[0] > 0.3:
                return None
            remaining.pop(best[1])
            path.extend(best[2][1:])
        return path

    def match(self, start, end, max_km=OSM_MATCH_KM):
        """Best single OSM ferry way whose ends lie near both terminals."""
        best = None
        for way_id, way in self.ways.items():
            coords = way["coords"]
            for flip in (False, True):
                c = coords[::-1] if flip else coords
                d0 = haversine_km(c[0], start)
                d1 = haversine_km(c[-1], end)
                if d0 <= max_km and d1 <= max_km:
                    score = d0 + d1
                    if best is None or score < best[0]:
                        best = (score, way_id, c)
        if best is None:
            return None
        return [best[1]], [list(p) for p in best[2]]


def snap_ends(path, start, end):
    """Replace the OSM way ends with our terminal coordinates.

    Vertices lying within 150 m of a terminal are dropped so the snapped end
    does not create a hook.
    """
    inner = [p for p in path[1:-1]
             if haversine_km(p, start) > 0.15 and haversine_km(p, end) > 0.15]
    return [list(start), *inner, list(end)]


# ---------------------------------------------------------------- per route


def _passes(model, paths):
    audit = audit_paths(model, paths)
    return not audit["failures"], audit


def _turn_degrees(path, index, reach_m=150.0):
    """Heading change at ``path[index]`` measured to vertices ~reach_m away."""
    point = path[index]
    before = next((path[k] for k in range(index - 1, -1, -1) if haversine_km(path[k], point) * 1000 >= reach_m), path[0])
    after = next((path[k] for k in range(index + 1, len(path)) if haversine_km(path[k], point) * 1000 >= reach_m), path[-1])
    scale = math.cos(math.radians(point[1]))
    v1 = ((point[0] - before[0]) * scale, point[1] - before[1])
    v2 = ((after[0] - point[0]) * scale, after[1] - point[1])
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if not n1 or not n2:
        return 0.0
    cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def _intermediate_landings(path, landings, radius_m=150.0):
    """Known landings where the path stops (turns sharply) between terminals."""
    visited = []
    for landing in landings:
        if (haversine_km(landing, path[0]) * 1000 <= 400
                or haversine_km(landing, path[-1]) * 1000 <= 400):
            continue
        for index in range(1, len(path) - 1):
            if haversine_km(landing, path[index]) * 1000 <= radius_m and _turn_degrees(path, index) >= 100:
                visited.append(landing)
                break
    return visited


def _near_all(path, points, radius_km=0.4):
    line = LineString(path)
    lat0 = path[0][1]
    for point in points:
        if line.distance(Point(point)) * min(M_PER_DEG_LAT, m_per_deg_lon(lat0)) / 1000 > radius_km:
            return False
    return True


def compute_path(model, osm, source_path, source_kind, config, landings):
    """Resolve one path. Returns (path, source_label, repaired, failures)."""
    path = [list(p) for p in source_path]
    terminals = config.get("terminals")
    degenerate = len(path) < 2 or polyline_km(path) <= MIN_LENGTH_KM
    if degenerate:
        if not terminals:
            raise RuntimeError("degenerate source path and no configured terminals")
        # A degenerate provider path carries no usable direction; the
        # configured terminals follow the route id's published order.
        start, end = terminals
        path = [list(start), list(end)]
    start, end = path[0], path[-1]
    is_loop = haversine_km(start, end) < 0.2
    visited = _intermediate_landings(path, landings) if not degenerate else []

    candidates = []
    if config.get("controls"):
        controls = config["controls"]
        chosen = min(controls, key=lambda c: haversine_km(c[0], start) + haversine_km(c[-1], end))
        candidates.append(("hand", [list(start), *chosen[1:-1], list(end)], "pull"))
    if source_kind == "gtfs" and not degenerate:
        candidates.append(("gtfs-shape", path, "keep"))
    osm_ids = config.get("osmWays")
    osm_path = None
    if osm_ids:
        chained = osm.chain(osm_ids, start)
        if chained:
            osm_path = (list(osm_ids), chained)
    elif not config.get("noOsm") and not is_loop and haversine_km(start, end) > 0.3:
        osm_path = osm.match(start, end)
    if osm_path:
        ids, coords = osm_path
        snapped = snap_ends(coords, start, end)
        if not visited or _near_all(snapped, visited):
            label = "osm-way:" + "+".join(str(i) for i in ids)
            candidates.append((label, snapped, "keep"))
    if source_kind == "hand" and not degenerate:
        candidates.append(("hand", path, "pull"))
    if not candidates:
        candidates.append(("hand", path, "pull"))

    # Prefer the first candidate that passes as-is (after a water-safe trim).
    for label, candidate, mode in candidates:
        if mode == "keep":
            ok, _ = _passes(model, [candidate])
            if ok:
                trimmed = rounded(water_simplify(model, rounded(candidate), 5.0))
                ok2, _ = _passes(model, [trimmed])
                return (trimmed if ok2 else rounded(candidate)), label, False, []
    best = None
    for label, candidate, mode in candidates:
        try:
            cleaned = clean_path(model, candidate, landings, mode)
        except RuntimeError as error:
            result = (None, label, True, [str(error)])
        else:
            ok, audit = _passes(model, [cleaned])
            if ok:
                return cleaned, label, mode == "keep", []
            result = (cleaned, label, True, audit["failures"])
        if best is None or (result[0] is not None and (best[0] is None or len(result[3]) < len(best[3]))):
            best = result
    return best


def compute_route(model, osm, route_id, source_paths, source_kind, config, landings):
    """Resolve every path of a route into an audited cache record."""
    out_paths = []
    labels = []
    repaired_any = False
    failures = []
    for index, source_path in enumerate(source_paths):
        path, label, repaired, path_failures_ = compute_path(
            model, osm, source_path, source_kind, config, landings,
        )
        if path is None:
            failures.extend(f"path {index}: {item}" for item in path_failures_)
            continue
        pins = [p for p in path[1:-1] if any(haversine_km(p, l) * 1000 <= 150 for l in landings)]
        parts = split_at_self_intersections(path, pins)
        out_paths.extend(parts)
        labels.append(label)
        repaired_any = repaired_any or repaired
    # Identical paths inside one route add nothing to the map.
    unique = []
    seen = set()
    for path in out_paths:
        token = canonical_coordinates(path)
        if token not in seen:
            seen.add(token)
            unique.append(path)
    audit = audit_paths(model, unique) if unique else {"failures": ["no paths"], "interiorDryM": 0, "endpointDryM": 0, "selfIntersects": False, "lengthKm": 0, "directKm": 0}
    all_failures = failures + audit["failures"]
    distinct = list(dict.fromkeys(labels))
    source = distinct[0] if len(distinct) == 1 else "+".join(distinct)
    return {
        "source": source,
        "repaired": repaired_any,
        "paths": unique,
        "lengthKm": audit["lengthKm"],
        "directKm": audit["directKm"],
        "waterAudit": {
            "auditVersion": AUDIT_VERSION,
            "interiorDryM": audit["interiorDryM"],
            "endpointDryM": audit["endpointDryM"],
            "selfIntersects": audit["selfIntersects"],
            "pass": not all_failures,
            **({"failures": all_failures} if all_failures else {}),
        },
    }
