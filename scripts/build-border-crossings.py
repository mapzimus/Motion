#!/usr/bin/env python3
"""Build New England's Canada border-crossing reference points from CBSA data."""

from __future__ import annotations

import argparse
import csv
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "border-crossings.geojson"
GEOCODE_CACHE = ROOT / "scripts" / "border-crossing-coordinates.json"
CBSA_CSV = "https://www.cbsa-asfc.gc.ca/data/offices-bureaux-en.csv"
CBSA_DIRECTORY = "https://www.cbsa-asfc.gc.ca/do-rb/menu-eng.html"
GEOCODER = "https://geogratis.gc.ca/services/geolocation/en/locate"


def download_text(url, encoding):
    request = urllib.request.Request(url, headers={"User-Agent": "mapzimus/Motion border-builder"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read().decode(encoding)


def new_england_crossing(row):
    us_port = row["US port"].upper()
    return (
        row["Physical Address Province"] in {"QC", "NB"}
        and row["US port"]
        and any(token in us_port for token in (" ME", ",ME", "MAINE", " VT", ",VT", "VERMONT", " NH", ",NH", "PITTSBURG"))
        and "NO PERMISSIBLE ENTRY" not in us_port
        and any(token in row["Services"] for token in ("HWY/B", "RAIL", "FERRY", "CLVS"))
    )


def geocode(row):
    query = ", ".join(filter(None, [
        row["Physical Address Line 1"],
        row["Physical Address Line 2"],
        row["Physical Address City"],
        row["Physical Address Province"],
    ]))
    url = GEOCODER + "?" + urllib.parse.urlencode({"q": query})
    request = urllib.request.Request(url, headers={"User-Agent": "mapzimus/Motion border-builder"})
    results = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                results = json.load(response)
            break
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(1.5 * (2 ** attempt))
    if not results:
        raise RuntimeError(f"NRCan could not geocode {query}")
    exact = next((item for item in results if item.get("qualifier") == "INTERPOLATED_POSITION"), results[0])
    longitude, latitude = exact["geometry"]["coordinates"]
    if not (-74.0 <= longitude <= -66.0 and 44.8 <= latitude <= 47.6):
        raise RuntimeError(f"Out-of-region geocode for {query}: {longitude}, {latitude}")
    return [round(longitude, 6), round(latitude, 6)]


def hours(row):
    weekday = row["Travellers Hours Monday"]
    weekend = row["Travellers Hours Saturday"]
    if weekday and weekend and weekday == weekend:
        return f"Daily {weekday.replace(' / ', '–')}"
    values = []
    if weekday:
        values.append(f"Mon {weekday.replace(' / ', '–')}")
    if weekend:
        values.append(f"Sat {weekend.replace(' / ', '–')}")
    return " · ".join(values) or "Hours vary; verify before travel"


def feature(row, coordinates):
    services = row["Services"]
    kinds = []
    if "HWY/B" in services or "CLVS" in services:
        kinds.append("road")
    if "RAIL" in services:
        kinds.append("rail")
    if "FERRY" in services:
        kinds.append("ferry")
    crossing_type = " + ".join(kinds) or "border"
    us_port = row["US port"].replace(" Station", "")
    upper_port = us_port.upper()
    if "VERMONT" in upper_port or " VT" in upper_port or ",VT" in upper_port:
        region = "vt"
    elif "NEW HAMPSHIRE" in upper_port or " NH" in upper_port or ",NH" in upper_port or "PITTSBURG" in upper_port:
        region = "nh"
    else:
        region = "me"
    status = f"Canada–U.S. {crossing_type} crossing · {us_port}"
    detail_parts = [hours(row)]
    if "PPTRA-Q" in services:
        detail_parts.append("remote-traveller pilot location")
    if row["Travellers Hours Seasonal"] == "True":
        detail_parts.append("seasonal hours")
    notes = row["Travellers Hours Notes"].replace("\r", " ").replace("\n", " ").strip()
    if notes:
        detail_parts.append(" ".join(notes.split())[:280])
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": coordinates},
        "properties": {
            "group": "border",
            "dataStatus": "reference",
            "color": "#f0d27a",
            "title": row["Office Name"],
            "status": status,
            "details": " · ".join(detail_parts),
            "provider": "Canada Border Services Agency directory",
            "sourceUrl": CBSA_DIRECTORY,
            "crossingType": crossing_type,
            "usPort": us_port,
            "province": row["Physical Address Province"],
            "regions": [region],
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    rows = [
        row for row in csv.DictReader(io.StringIO(download_text(CBSA_CSV, "cp1252")))
        if new_england_crossing(row)
    ]
    cache = json.loads(GEOCODE_CACHE.read_text(encoding="utf-8")) if GEOCODE_CACHE.exists() else {}
    features = []
    for index, row in enumerate(rows, 1):
        cache_key = f"{row['Office Name']}|{row['US port']}"
        coordinates = cache.get(cache_key)
        fetched = coordinates is None
        if coordinates is None:
            coordinates = geocode(row)
            cache[cache_key] = coordinates
            GEOCODE_CACHE.write_text(
                json.dumps(dict(sorted(cache.items())), indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )
        features.append(feature(row, coordinates))
        print(f"{index}/{len(rows)} {row['Office Name']}")
        if fetched:
            time.sleep(0.8)
    features.sort(key=lambda item: (item["properties"]["province"], item["properties"]["title"]))
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "Canada Border Services Agency Directory of Offices",
            "sourceUrl": CBSA_DIRECTORY,
            "geocoder": "Natural Resources Canada Geolocation Service",
            "count": len(features),
            "note": "Canadian-side control points for physical New England road, rail, ferry, and remote border crossings.",
        },
        "features": features,
    }
    args.output.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(features)} crossings to {args.output}")


if __name__ == "__main__":
    main()
