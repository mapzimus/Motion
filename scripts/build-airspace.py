#!/usr/bin/env python3
"""Build New England's FAA airspace reference layer (public/data/airspace.geojson).

Class B/C/D surface areas and shelves plus special-use airspace (MOAs,
restricted, warning, prohibited, and alert areas) from the FAA Aeronautical
Data Delivery Service (ADDS) ArcGIS feature services. The FAA republishes these
on the 28-day NASR cycle, so rebuild every cycle:

    py -3 -X utf8 scripts/build-airspace.py

Geometry is generalized server-side (maxAllowableOffset ~50 m, 5-decimal
coordinates). This is reference data for orientation only: special-use areas
are often active "INTERMITTENT BY NOTAM", and nothing here replaces current
charts or NOTAMs.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "data" / "airspace.geojson"
USER_AGENT = "motion-map (github.com/mapzimus/Motion) airspace-builder"

SERVICE = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services"
CLASS_LAYER = f"{SERVICE}/Class_Airspace/FeatureServer/0"
SUA_LAYER = f"{SERVICE}/Special_Use_Airspace/FeatureServer/0"
DATASET_PAGE = "https://adds-faa.opendata.arcgis.com/"

# west, south, east, north — the same box the gateway uses for METARs and TFRs.
BBOX = (-73.8, 40.9, -66.9, 47.5)
NEW_ENGLAND_STATES = {"MA", "CT", "RI", "NH", "VT", "ME"}
MAX_ALLOWABLE_OFFSET = 0.0005  # degrees, ~50 m
GEOMETRY_PRECISION = 5
PAGE_SIZE = 2000  # service maxRecordCount

# U.S. class airspace only (Canadian CTR/TMA polygons share the layer).
CLASS_WHERE = "CLASS IN ('B','C','D') AND TYPE_CODE = 'CLASS'"
CLASS_FIELDS = [
    "GLOBAL_ID", "IDENT", "ICAO_ID", "NAME", "CLASS", "SECTOR", "CITY", "STATE",
    "LOWER_VAL", "LOWER_UOM", "LOWER_CODE", "UPPER_VAL", "UPPER_UOM", "UPPER_CODE", "UPPER_DESC",
    "WKHR_CODE", "WKHR_RMK",
]
SUA_WHERE = "COUNTRY = 'UNITED STATES'"
SUA_FIELDS = [
    "GLOBAL_ID", "NAME", "TYPE_CODE", "CITY", "STATE",
    "LOWER_VAL", "LOWER_UOM", "LOWER_CODE", "UPPER_VAL", "UPPER_UOM", "UPPER_CODE", "UPPER_DESC",
    "TIMESOFUSE", "CONT_AGENT",
]

SUA_TYPES = {
    "MOA": "Military operations area",
    "R": "Restricted area",
    "W": "Warning area",
    "P": "Prohibited area",
    "A": "Alert area",
    "D": "Danger area",
}
KEEP_UPPER = {"MOA", "B", "C", "D", "E", "VOR", "VOR/DME", "VORTAC", "AFB", "ANG", "NAS", "USCG"}


def get_json(url: str, params: dict | None = None) -> dict:
    full = url + ("?" + urllib.parse.urlencode(params) if params else "")
    request = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.load(response)
            if isinstance(payload, dict) and payload.get("error"):
                raise RuntimeError(f"{url}: {payload['error']}")
            return payload
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(1.5 * (2 ** attempt))
    raise RuntimeError("unreachable")


def query_layer(layer: str, where: str, fields: list[str]) -> tuple[list[dict], str]:
    """Every feature in the bbox, paging past maxRecordCount if ever needed."""
    features: list[dict] = []
    offset = 0
    while True:
        params = {
            "where": where,
            "geometry": ",".join(str(value) for value in BBOX),
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": ",".join(fields),
            "outSR": 4326,
            "maxAllowableOffset": MAX_ALLOWABLE_OFFSET,
            "geometryPrecision": GEOMETRY_PRECISION,
            "orderByFields": "OBJECTID",
            "resultOffset": offset,
            "resultRecordCount": PAGE_SIZE,
            "f": "geojson",
        }
        page = get_json(f"{layer}/query", params)
        batch = page.get("features") or []
        features.extend(batch)
        exceeded = page.get("exceededTransferLimit") or (page.get("properties") or {}).get("exceededTransferLimit")
        if not exceeded or not batch:
            break
        offset += len(batch)
    query_url = f"{layer}/query?" + urllib.parse.urlencode({
        "where": where,
        "geometry": ",".join(str(value) for value in BBOX),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "outFields": ",".join(fields),
        "outSR": 4326,
        "maxAllowableOffset": MAX_ALLOWABLE_OFFSET,
        "geometryPrecision": GEOMETRY_PRECISION,
        "f": "geojson",
    })
    return features, query_url


def layer_edit_date(layer: str) -> str:
    info = get_json(layer, {"f": "json"})
    millis = (info.get("editingInfo") or {}).get("dataLastEditDate")
    if not millis:
        return ""
    return dt.datetime.fromtimestamp(millis / 1000, tz=dt.timezone.utc).strftime("%Y-%m-%d")


def nice_name(name: str) -> str:
    """FAA names are upper case; title-case words but keep identifiers."""
    words = []
    for word in (name or "").split():
        bare = word.strip(",()")
        if any(character.isdigit() for character in bare) or bare in KEEP_UPPER or "-" in bare and len(bare) <= 8:
            words.append(word)
        else:
            words.append(word.capitalize() if "/" not in word else "/".join(part.capitalize() for part in word.split("/")))
    return " ".join(words)


def number(value) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result


def altitude(value, uom, code) -> tuple[str, int | None]:
    """Readable altitude plus an approximate number of feet for sorting."""
    amount = number(value)
    uom = (uom or "").upper()
    code = (code or "").upper()
    if code == "UNLTD" or amount is None or amount <= -9000:
        return "Unlimited", None
    if uom == "FL":
        return f"FL{int(amount):03d}", int(amount * 100)
    if code == "SFC":
        return ("Surface", 0) if amount == 0 else (f"{int(amount):,} ft AGL", int(amount))
    if code in {"MSL", "AGL"}:
        return f"{int(amount):,} ft {code}", int(amount)
    return " ".join(part for part in (f"{int(amount):,}", uom.lower(), code) if part), int(amount)


def valid_ring(ring) -> bool:
    return (
        isinstance(ring, list)
        and len(ring) >= 4
        and ring[0] == ring[-1]
        and all(isinstance(point, list) and len(point) >= 2 for point in ring)
    )


def clean_geometry(geometry: dict | None) -> dict | None:
    if not geometry:
        return None
    if geometry.get("type") == "Polygon":
        rings = [ring for ring in geometry.get("coordinates") or [] if valid_ring(ring)]
        return {"type": "Polygon", "coordinates": rings} if rings else None
    if geometry.get("type") == "MultiPolygon":
        polygons = []
        for polygon in geometry.get("coordinates") or []:
            rings = [ring for ring in polygon if valid_ring(ring)]
            if rings:
                polygons.append(rings)
        if not polygons:
            return None
        return {"type": "Polygon", "coordinates": polygons[0]} if len(polygons) == 1 else {
            "type": "MultiPolygon", "coordinates": polygons,
        }
    return None


def class_times(code: str, remark: str) -> str:
    code = (code or "").upper()
    if code == "H24":
        return "Continuous"
    if code == "NOTAM":
        return "Part-time; hours set by NOTAM / Chart Supplement"
    return remark or code or ""


def class_feature(source: dict) -> dict | None:
    p = source.get("properties") or {}
    geometry = clean_geometry(source.get("geometry"))
    airspace_class = (p.get("CLASS") or "").upper()
    if not geometry or airspace_class not in {"B", "C", "D"} or p.get("STATE") not in NEW_ENGLAND_STATES:
        return None
    floor, floor_ft = altitude(p.get("LOWER_VAL"), p.get("LOWER_UOM"), p.get("LOWER_CODE"))
    ceiling, ceiling_ft = altitude(p.get("UPPER_VAL"), p.get("UPPER_UOM"), p.get("UPPER_CODE"))
    sector = nice_name(p.get("SECTOR") or "")
    title = nice_name(p.get("NAME") or f"Class {airspace_class}")
    feature_id = f"class-{(p.get('GLOBAL_ID') or '').lower()}"
    return {
        "type": "Feature",
        "id": feature_id,
        "geometry": geometry,
        "properties": {
            "airspaceId": feature_id,
            "group": "airspace",
            "dataStatus": "reference",
            "kind": "class",
            "styleKey": airspace_class,
            "airspaceClass": airspace_class,
            "title": f"{title} · {sector}" if sector else title,
            "status": f"Class {airspace_class} airspace",
            "icaoId": p.get("ICAO_ID") or "",
            "state": p.get("STATE") or "",
            "floor": floor,
            "floorFt": floor_ft,
            "ceiling": ceiling,
            "ceilingFt": ceiling_ft,
            "ceilingInclusive": (p.get("UPPER_DESC") or "TI").upper() != "TNI",
            "timesOfUse": class_times(p.get("WKHR_CODE"), p.get("WKHR_RMK")),
            "provider": "FAA ADDS Class Airspace (NASR)",
            "sourceUrl": DATASET_PAGE,
        },
    }


def sua_feature(source: dict) -> dict | None:
    p = source.get("properties") or {}
    geometry = clean_geometry(source.get("geometry"))
    sua_type = (p.get("TYPE_CODE") or "").upper()
    state = p.get("STATE") or ""
    if not geometry or sua_type not in SUA_TYPES or (state and state not in NEW_ENGLAND_STATES):
        return None
    floor, floor_ft = altitude(p.get("LOWER_VAL"), p.get("LOWER_UOM"), p.get("LOWER_CODE"))
    ceiling, ceiling_ft = altitude(p.get("UPPER_VAL"), p.get("UPPER_UOM"), p.get("UPPER_CODE"))
    agency = (p.get("CONT_AGENT") or "").strip()
    feature_id = f"sua-{(p.get('GLOBAL_ID') or '').lower()}"
    return {
        "type": "Feature",
        "id": feature_id,
        "geometry": geometry,
        "properties": {
            "airspaceId": feature_id,
            "group": "airspace",
            "dataStatus": "reference",
            "kind": "special-use",
            "styleKey": "sua",
            "suaType": sua_type,
            "title": nice_name(p.get("NAME") or SUA_TYPES[sua_type]),
            "status": SUA_TYPES[sua_type],
            "state": state,
            "floor": floor,
            "floorFt": floor_ft,
            "ceiling": ceiling,
            "ceilingFt": ceiling_ft,
            "ceilingInclusive": (p.get("UPPER_DESC") or "TI").upper() != "TNI",
            "timesOfUse": (p.get("TIMESOFUSE") or "").strip(),
            "controllingAgency": agency,
            "provider": "FAA ADDS Special Use Airspace (NASR)",
            "sourceUrl": DATASET_PAGE,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    class_source, class_url = query_layer(CLASS_LAYER, CLASS_WHERE, CLASS_FIELDS)
    sua_source, sua_url = query_layer(SUA_LAYER, SUA_WHERE, SUA_FIELDS)
    features = [feature for feature in map(class_feature, class_source) if feature]
    features += [feature for feature in map(sua_feature, sua_source) if feature]
    # Big shelves first so smaller areas draw (and click) on top.
    order = {"B": 0, "C": 1, "D": 2, "sua": 3}
    features.sort(key=lambda feature: (order[feature["properties"]["styleKey"]], feature["properties"]["title"], feature["properties"]["floorFt"] or 0))

    counts: dict[str, int] = {}
    for feature in features:
        key = feature["properties"]["styleKey"]
        counts[key] = counts.get(key, 0) + 1
    if not all(counts.get(key) for key in ("B", "C", "D", "sua")):
        raise SystemExit(f"Airspace coverage looks incomplete: {counts}")

    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "FAA Aeronautical Data Delivery Service (ADDS) ArcGIS feature services, 28-day NASR cycle",
            "sourceUrls": [class_url, sua_url],
            "datasetPage": DATASET_PAGE,
            "fetchedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "dataLastEdited": {
                "classAirspace": layer_edit_date(CLASS_LAYER),
                "specialUseAirspace": layer_edit_date(SUA_LAYER),
            },
            "bbox": list(BBOX),
            "states": sorted(NEW_ENGLAND_STATES),
            "generalization": {"maxAllowableOffsetDeg": MAX_ALLOWABLE_OFFSET, "geometryPrecision": GEOMETRY_PRECISION},
            "counts": counts,
            "note": "Reference only: check current charts and NOTAMs before flying. Special-use areas are often "
                    "active intermittently by NOTAM; class D and some class C hours are part-time.",
            "rebuild": "py -3 -X utf8 scripts/build-airspace.py",
        },
        "features": features,
    }
    args.output.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size = args.output.stat().st_size
    print(f"Wrote {args.output.relative_to(ROOT)}: {len(features)} features {counts}, {size:,} bytes")


if __name__ == "__main__":
    main()
