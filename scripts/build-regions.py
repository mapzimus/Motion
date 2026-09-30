#!/usr/bin/env python3
"""Build data/regions.geojson from scripts/regions-config.json.

Every map region (the six states, the MBTA core, Greater Boston inside I-495,
and the named sub-state regions) is defined in the config file. This script
fetches the matching Census TIGERweb boundaries, dissolves each region's
members into one generalized polygon, and writes one feature per region with
all of the config properties attached, in config order. The virtual
``new-england`` region (the union of the six states) is described in the
collection metadata rather than stored as a geometry.

Checks that fail the build:
  * a configured town or county is missing from TIGERweb (or extra ones match)
  * a region's member count differs from ``memberCount`` in the config
  * the Greater Boston town list no longer matches a fresh I-495 ring
    computation from data/infrastructure.geojson
  * the output is larger than ``maxBytes``

Usage:
  py -3 -X utf8 scripts/build-regions.py
  py -3 -X utf8 scripts/build-regions.py --cache-dir .tiger-cache   # reuse downloads
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

from shapely import make_valid
from shapely.geometry import Polygon, box, mapping, shape
from shapely.ops import linemerge, unary_union


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "scripts" / "regions-config.json"
INFRASTRUCTURE_PATH = ROOT / "data" / "infrastructure.geojson"
OUTPUT = ROOT / "data" / "regions.geojson"

TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
STATES_QUERY = f"{TIGERWEB}/State_County/MapServer/0/query"
COUNTIES_QUERY = f"{TIGERWEB}/State_County/MapServer/1/query"
COUSUB_QUERY = f"{TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/1/query"
STATE_FIPS = {"CT": "09", "MA": "25", "ME": "23", "NH": "33", "RI": "44", "VT": "50"}
PAGE_SIZE = 200
COORDINATE_DIGITS = 5  # about 1 m; plenty for boundaries generalized to 10+ m


def tiger_query(url, where, fields, cache_dir=None, cache_name=None):
    """Page through a TIGERweb layer and return GeoJSON features."""
    cache_file = cache_dir / f"{cache_name}.json" if cache_dir and cache_name else None
    if cache_file and cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))
    features = []
    offset = 0
    while True:
        params = urllib.parse.urlencode({
            "f": "geojson",
            "where": where,
            "outFields": fields,
            "returnGeometry": "true",
            "outSR": "4326",
            "geometryPrecision": "6",
            "orderByFields": "GEOID",
            "resultOffset": offset,
            "resultRecordCount": PAGE_SIZE,
        })
        request = urllib.request.Request(
            f"{url}?{params}",
            headers={"User-Agent": "New England in Motion boundary builder"},
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            page = json.load(response)
        if "error" in page:
            raise RuntimeError(f"TIGERweb error for {url}: {page['error']}")
        batch = page.get("features", [])
        features.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    if cache_file:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(features), encoding="utf-8")
    return features


def public_town_name(basename):
    # Census BASENAME values for some towns end in "Town" ("Braintree Town",
    # "Winthrop Town") even though their public-facing names do not.
    return basename[:-5] if basename.endswith(" Town") else basename


def geometry_of(feature):
    return make_valid(shape(feature["geometry"]))


def round_coordinates(value):
    if isinstance(value, (list, tuple)) and value and isinstance(value[0], (int, float)):
        return [round(value[0], COORDINATE_DIGITS), round(value[1], COORDINATE_DIGITS)]
    return [round_coordinates(child) for child in value]


def polygonal(geometry):
    """Drop stray lines/points that make_valid or unary_union can leave behind."""
    if geometry.geom_type in {"Polygon", "MultiPolygon"}:
        return geometry
    parts = [part for part in getattr(geometry, "geoms", []) if part.geom_type in {"Polygon", "MultiPolygon"}]
    return unary_union(parts)


def dissolve(geometries, tolerance):
    merged = polygonal(unary_union(geometries))
    simplified = polygonal(make_valid(merged.simplify(tolerance, preserve_topology=True)))
    output = mapping(simplified)
    output = {"type": output["type"], "coordinates": round_coordinates(output["coordinates"])}
    return output


def i495_ring(settings):
    """Close the I-495 arc along the coast into a polygon.

    I-495 runs from Salisbury to Wareham. The builder merges the Census
    primary-road pieces, keeps the longest continuous run, orients it north to
    south, and closes it with two points pushed out to sea so every coastal
    town inside the arc falls inside the ring.
    """
    infrastructure = json.loads(INFRASTRUCTURE_PATH.read_text(encoding="utf-8"))
    lines = [
        shape(feature["geometry"])
        for feature in infrastructure.get("features", [])
        if "I- 495" in (feature.get("properties", {}).get("title") or "")
    ]
    if not lines:
        raise RuntimeError("No I-495 geometry found in data/infrastructure.geojson")
    # The clip box drops New York's unrelated I-495 (Long Island Expressway).
    clipped = unary_union(lines).intersection(box(*settings["clipBox"]))
    merged = linemerge(clipped)
    parts = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    arc = max(parts, key=lambda part: part.length)
    coordinates = list(arc.coords)
    if coordinates[0][1] < coordinates[-1][1]:
        coordinates.reverse()
    offset = settings["closeOffsetLng"]
    north, south = coordinates[0], coordinates[-1]
    ring = [(north[0] + offset, north[1]), *coordinates, (south[0] + offset, south[1])]
    polygon = make_valid(Polygon(ring))
    if polygon.is_empty:
        raise RuntimeError("I-495 ring could not be closed")
    return polygon


def towns_inside_ring(towns, settings):
    ring = i495_ring(settings)
    inside = []
    for feature in towns:
        basename = feature["properties"]["BASENAME"]
        # Offshore county water carries this placeholder name; it is not a town.
        if basename == "County subdivisions not defined":
            continue
        geometry = geometry_of(feature)
        if geometry.area and geometry.intersection(ring).area / geometry.area >= settings["minShareInside"]:
            inside.append(public_town_name(basename))
    return sorted(inside)


def build_state(region, states, tolerance):
    matches = [feature for feature in states if feature["properties"]["STUSAB"] == region["stusab"]]
    if len(matches) != 1:
        raise RuntimeError(f"{region['key']}: expected 1 TIGERweb state, found {len(matches)}")
    return dissolve([geometry_of(matches[0])], tolerance), [matches[0]["properties"]["NAME"]]


def build_counties(region, counties, tolerance):
    wanted = {}
    for member in region["members"]:
        name, _, state = member.rpartition(", ")
        wanted[(STATE_FIPS[state], name)] = member
    found = {}
    for feature in counties:
        key = (feature["properties"]["STATE"], feature["properties"]["BASENAME"])
        if key in wanted:
            found.setdefault(key, []).append(feature)
    missing = sorted(wanted[key] for key in wanted if key not in found)
    duplicated = sorted(wanted[key] for key, matches in found.items() if len(matches) > 1)
    if missing or duplicated:
        raise RuntimeError(f"{region['key']}: counties missing={missing} duplicated={duplicated}")
    geometries = [geometry_of(found[key][0]) for key in wanted]
    return dissolve(geometries, tolerance), list(region["members"])


def build_towns(region, towns, tolerance):
    by_name = {}
    for feature in towns:
        by_name.setdefault(public_town_name(feature["properties"]["BASENAME"]), []).append(feature)
    missing = sorted(name for name in region["members"] if name not in by_name)
    duplicated = sorted(name for name in region["members"] if len(by_name.get(name, [])) > 1)
    if missing or duplicated:
        raise RuntimeError(f"{region['key']}: towns missing={missing} duplicated={duplicated}")
    geometries = [geometry_of(by_name[name][0]) for name in region["members"]]
    return dissolve(geometries, tolerance), sorted(region["members"])


def check_member_count(region, members):
    expected = region.get("memberCount")
    if expected is not None and len(members) != expected:
        raise RuntimeError(f"{region['key']}: {len(members)} members, config says {expected}")


def feature_properties(region, members):
    properties = {key: value for key, value in region.items() if key not in {"members", "memberCount"}}
    properties["members"] = members
    properties["memberCount"] = len(members)
    return properties


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cache-dir", type=Path, help="Reuse TIGERweb downloads from this folder")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    tolerances = config["simplify"]
    regions = config["regions"]
    keys = [region["key"] for region in regions]
    if len(keys) != len(set(keys)):
        raise RuntimeError("Duplicate region keys in regions-config.json")
    group_keys = {group["key"] for group in config["groups"]}
    for region in regions:
        if region["group"] not in group_keys:
            raise RuntimeError(f"{region['key']}: unknown group {region['group']}")
        if region.get("parent") and region["parent"] not in keys:
            raise RuntimeError(f"{region['key']}: unknown parent {region['parent']}")

    state_list = ",".join(f"'{fips}'" for fips in STATE_FIPS.values())
    states = tiger_query(STATES_QUERY, f"STATE IN ({state_list})", "GEOID,NAME,STATE,STUSAB", args.cache_dir, "states")
    counties = tiger_query(COUNTIES_QUERY, f"STATE IN ({state_list})", "GEOID,NAME,BASENAME,STATE", args.cache_dir, "counties")
    town_states = sorted({region["state"] for region in regions if region["kind"] == "towns"})
    towns_by_state = {
        state: tiger_query(
            COUSUB_QUERY,
            f"STATE='{STATE_FIPS[state]}'",
            "GEOID,NAME,BASENAME,STATE,COUNTY",
            args.cache_dir,
            f"cousub-{state}",
        )
        for state in town_states
    }

    features = []
    virtual = []
    for region in regions:
        kind = region["kind"]
        if kind == "union":
            missing = [key for key in region["members"] if key not in keys]
            if missing:
                raise RuntimeError(f"{region['key']}: union members missing {missing}")
            virtual.append(feature_properties(region, list(region["members"])))
            continue
        if kind == "state":
            geometry, members = build_state(region, states, tolerances["state"])
        elif kind == "counties":
            geometry, members = build_counties(region, counties, tolerances["counties"])
        elif kind == "towns":
            towns = towns_by_state[region["state"]]
            if region.get("ring"):
                computed = towns_inside_ring(towns, config["ring"][region["ring"]])
                configured = sorted(region["members"])
                if computed != configured:
                    added = sorted(set(computed) - set(configured))
                    removed = sorted(set(configured) - set(computed))
                    raise RuntimeError(
                        f"{region['key']}: {region['ring']} ring now selects a different town list; "
                        f"added={added} removed={removed}. Review and update regions-config.json.",
                    )
            geometry, members = build_towns(region, towns, tolerances["towns"])
        else:
            raise RuntimeError(f"{region['key']}: unknown kind {kind}")
        check_member_count(region, members)
        features.append({"type": "Feature", "properties": feature_properties(region, members), "geometry": geometry})

    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "source": config["source"],
            "builtFrom": "scripts/regions-config.json via scripts/build-regions.py",
            "order": keys,
            "groups": config["groups"],
            "virtualRegions": virtual,
        },
        "features": features,
    }
    text = json.dumps(collection, ensure_ascii=False, separators=(",", ":")) + "\n"
    size = len(text.encode("utf-8"))
    if size > config["maxBytes"]:
        raise RuntimeError(f"regions.geojson would be {size:,} bytes; limit is {config['maxBytes']:,}")
    args.output.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {len(features)} regions (+{len(virtual)} virtual) to {args.output} ({size:,} bytes)")
    for feature in features:
        properties = feature["properties"]
        print(f"  {properties['key']:<22} {properties['kind']:<9} {properties['memberCount']:>4} members")

    # Hook for the marine (coastal-buffer) boundaries used by the vessel
    # filter. PR feat/ais-hub adds build_marine() to this script; when it is
    # present it is called with the fresh collection so data/regions-marine.geojson
    # always covers every region in the config.
    build_marine = globals().get("build_marine")
    if callable(build_marine):
        build_marine(collection)


if __name__ == "__main__":
    main()
