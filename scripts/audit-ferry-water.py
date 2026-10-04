#!/usr/bin/env python3
"""Audit ferry geometry against the OpenStreetMap land/water model.

The land model is OSM coastline land polygons minus OSM inland water
(``fetch-ferry-audit-data.py``); the rules live in ``ferry_water.py``
(``AUDIT_VERSION = "osm-land-v3"``). Modes:

* default: audit every ferry line in ``data/regional-routes.geojson`` (or
  ``--geojson``) and exit non-zero on any failure;
* ``--cache``: re-audit every entry of ``scripts/ferry-water-cache.json`` and
  confirm the stored metrics are current;
* ``--report``: write ``scripts/ferry-water-report.md`` comparing a BEFORE
  geojson (``--before``, e.g. the committed snapshot) with the cache (AFTER);
* ``--write-controls``: replace the coordinates of hand-drawn supplemental
  ferries with a sparse, water-safe version of their audited cache geometry.

Geometry itself is produced by ``build-regional-routes.py --update-ferry-cache``.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import ferry_water as fw  # noqa: E402

REGIONAL_ROUTES = ROOT / "public" / "data" / "regional-routes.geojson"
CACHE_PATH = ROOT / "scripts" / "ferry-water-cache.json"
REPORT_PATH = ROOT / "scripts" / "ferry-water-report.md"
SUPPLEMENTAL_FILES = [
    ROOT / "scripts" / "supplemental-routes.json",
    ROOT / "scripts" / "supplemental-ferry-routes.json",
]


def feature_paths(geometry):
    if geometry.get("type") == "LineString":
        return [geometry["coordinates"]]
    if geometry.get("type") == "MultiLineString":
        return geometry["coordinates"]
    return []


def ferry_features(collection):
    return [
        feature for feature in collection.get("features", [])
        if feature.get("properties", {}).get("group") == "ferry"
        and feature.get("properties", {}).get("kind") == "regional-static"
        and feature.get("geometry", {}).get("type") in {"LineString", "MultiLineString"}
    ]


def audit_geometry(model, paths):
    usable = [path for path in paths if len(path) >= 2]
    if not usable:
        return {"interiorDryM": 0.0, "endpointDryM": 0.0, "selfIntersects": False,
                "lengthKm": 0.0, "directKm": 0.0, "failures": ["no drawable path"]}
    return fw.audit_paths(model, usable)


def identical_geometry(cache):
    aliases = cache.get("aliases", {})
    by_hash = {}
    for route_id, record in cache.get("routes", {}).items():
        by_hash.setdefault(record.get("geometrySha256"), []).append(route_id)
    problems = []
    for routes in by_hash.values():
        if len(routes) < 2:
            continue
        canonical = {aliases.get(route, route) for route in routes}
        if len(canonical) > 1:
            problems.append(routes)
    return problems


def run_geojson(model, path):
    collection = json.loads(path.read_text(encoding="utf-8"))
    failures = 0
    for feature in ferry_features(collection):
        route = feature["properties"]["route"]
        audit = audit_geometry(model, feature_paths(feature["geometry"]))
        if audit["failures"]:
            failures += 1
            print(f"FAIL {route}: " + "; ".join(audit["failures"]))
    print(f"Audited {len(ferry_features(collection))} ferry routes; {failures} failed")
    return failures


def run_cache(model):
    cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    failures = 0
    for route_id, record in cache.get("routes", {}).items():
        paths = feature_paths({"type": record["geometryType"], "coordinates": record["coordinates"]})
        audit = audit_geometry(model, paths)
        stored = record.get("waterAudit", {})
        problems = list(audit["failures"])
        if stored.get("auditVersion") != fw.AUDIT_VERSION:
            problems.append("stale audit version")
        if abs(stored.get("interiorDryM", 0) - audit["interiorDryM"]) > 1 or abs(stored.get("endpointDryM", 0) - audit["endpointDryM"]) > 1:
            problems.append("stored dry metrics are stale")
        if record.get("geometrySha256") != fw.geometry_sha256(record["coordinates"]):
            problems.append("geometry hash mismatch")
        if problems:
            failures += 1
            print(f"FAIL {route_id}: " + "; ".join(problems))
    for routes in identical_geometry(cache):
        failures += 1
        print(f"FAIL identical geometry without an alias: {', '.join(routes)}")
    print(f"Audited {len(cache.get('routes', {}))} cached ferry routes; {failures} failed")
    return failures


def fmt(value, unit=""):
    return f"{value:,.0f}{unit}" if value else "0"


def run_report(model, before_path):
    cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    before = {}
    if before_path and before_path.exists():
        for feature in ferry_features(json.loads(before_path.read_text(encoding="utf-8"))):
            before[feature["properties"]["route"]] = audit_geometry(model, feature_paths(feature["geometry"]))
    rows = []
    for route_id, record in sorted(cache.get("routes", {}).items()):
        after = record["waterAudit"]
        ratio = record["lengthKm"] / record["directKm"] if record["directKm"] else None
        prior = before.get(route_id)
        rows.append((route_id, record, after, ratio, prior))
    sources = {}
    for _, record, *_ in rows:
        key = record["source"].split(":")[0] if not record["source"].startswith("osm-way") else "osm-way"
        key = key + (" (repaired)" if record.get("repaired") else "")
        sources[key] = sources.get(key, 0) + 1
    failing_before = sum(1 for *_, prior in rows if prior and prior["failures"])
    failing_after = sum(1 for _, _, after, _, _ in rows if not after.get("pass"))
    lines = [
        "# Ferry water audit report",
        "",
        f"Generated {datetime.date.today().isoformat()} by `scripts/audit-ferry-water.py --report`.",
        f"Audit version `{fw.AUDIT_VERSION}`: OpenStreetMap coastline land polygons minus OSM inland water.",
        f"Rules: interior dry run <= {fw.MAX_INTERIOR_DRY_M:.0f} m; dry run within {fw.ENDPOINT_ZONE_M:.0f} m of an endpoint"
        f" <= {fw.MAX_ENDPOINT_DRY_M:.0f} m; no self-intersection; each path > {fw.MIN_LENGTH_KM} km and"
        f" >= {fw.MIN_LENGTH_RATIO} x terminal distance.",
        "",
        "BEFORE = the previously committed `data/regional-routes.geojson` geometry measured with the new model"
        " (`-` = route not in that snapshot, e.g. a newly adopted GTFS feed id). AFTER = `scripts/ferry-water-cache.json`.",
        "Dry metres are the longest single dry run of each kind.",
        "",
        f"Routes: {len(rows)} · failing BEFORE: {failing_before} · failing AFTER: {failing_after}",
        "",
        "Geometry sources: " + ", ".join(f"{name} {count}" for name, count in sorted(sources.items())),
        "",
        "| Route | Source | Length km | Length / direct | Interior dry m (before → after) | Endpoint dry m (before → after) | Self-int. before | Result |",
        "|---|---|---:|---:|---:|---:|:---:|:---:|",
    ]
    for route_id, record, after, ratio, prior in rows:
        source = record["source"] + (" (repaired)" if record.get("repaired") else "")
        ratio_text = f"{ratio:.2f}" if ratio is not None else "loop"
        if prior:
            interior = f"{fmt(prior['interiorDryM'])} → {fmt(after['interiorDryM'])}"
            endpoint = f"{fmt(prior['endpointDryM'])} → {fmt(after['endpointDryM'])}"
            selfint = "yes" if prior["selfIntersects"] else "no"
            if prior["lengthKm"] <= fw.MIN_LENGTH_KM:
                selfint += " (zero-length)"
        else:
            interior = f"- → {fmt(after['interiorDryM'])}"
            endpoint = f"- → {fmt(after['endpointDryM'])}"
            selfint = "-"
        result = "pass" if after.get("pass") else "FAIL: " + "; ".join(after.get("failures", []))
        lines.append(
            f"| `{route_id}` | {source} | {record['lengthKm']:.2f} | {ratio_text} | {interior} | {endpoint} | {selfint} | {result} |"
        )
    retired = sorted(set(before) - set(cache.get("routes", {})))
    if retired:
        lines += ["", "Routes in the BEFORE snapshot that no longer exist under the same id:", ""]
        for route_id in retired:
            prior = before[route_id]
            lines.append(
                f"- `{route_id}`: interior {fmt(prior['interiorDryM'])} m, endpoint {fmt(prior['endpointDryM'])} m"
                + (", self-intersecting" if prior["selfIntersects"] else "")
            )
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {REPORT_PATH}")


def run_write_controls(model, tolerance_m):
    """Store sparse audited controls back into the hand-drawn catalogs."""
    cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    changed = 0
    for path in SUPPLEMENTAL_FILES:
        raw = path.read_text(encoding="utf-8")
        document = json.loads(raw)
        for feature in document["features"]:
            properties = feature.get("properties", {})
            if properties.get("group") != "ferry":
                continue
            record = cache.get("routes", {}).get(properties.get("route"))
            if not record or not record.get("waterAudit", {}).get("pass"):
                continue
            paths = feature_paths({"type": record["geometryType"], "coordinates": record["coordinates"]})
            sparse = [fw.rounded(fw.water_simplify(model, p, tolerance_m)) for p in paths]
            if any(fw.path_failures(fw.path_metrics(model, p)) for p in sparse):
                sparse = paths
            new_coordinates = sparse[0] if record["geometryType"] == "LineString" else sparse
            if feature["geometry"]["type"] != record["geometryType"]:
                continue
            old_json = json.dumps(feature["geometry"]["coordinates"], separators=(",", ":"))
            new_json = json.dumps(new_coordinates, separators=(",", ":"))
            if old_json == new_json or old_json not in raw:
                continue
            raw = raw.replace(old_json, new_json, 1)
            changed += 1
        path.write_text(raw, encoding="utf-8", newline="")
    print(f"Rewrote controls for {changed} hand-drawn ferry routes")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--geojson", type=Path, default=REGIONAL_ROUTES)
    parser.add_argument("--cache", action="store_true")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--before", type=Path, help="BEFORE geojson for --report")
    parser.add_argument("--write-controls", action="store_true")
    parser.add_argument("--control-tolerance", type=float, default=40.0)
    args = parser.parse_args()
    model = fw.WaterModel()
    if args.write_controls:
        run_write_controls(model, args.control_tolerance)
        return
    if args.report:
        run_report(model, args.before)
        return
    failures = run_cache(model) if args.cache else run_geojson(model, args.geojson)
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
