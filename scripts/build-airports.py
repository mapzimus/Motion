#!/usr/bin/env python3
"""Build the checked-in New England FAA landing-facility reference layer."""

from __future__ import annotations

import argparse
import csv
import io
import json
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "airports.geojson"
DEFAULT_APT_URL = "https://nfdc.faa.gov/webContent/28DaySub/extra/06_Aug_2026_APT_CSV.zip"
SOURCE_PAGE = "https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/NASR_Subscription/2026-08-06/"
NEW_ENGLAND = {"CT", "RI", "MA", "VT", "NH", "ME"}

FACILITY_TYPES = {
    "A": "Airport",
    "B": "Balloonport",
    "C": "Seaplane base",
    "G": "Gliderport",
    "H": "Heliport",
    "U": "Ultralight facility",
}
OWNERSHIP_TYPES = {
    "PU": "Publicly owned",
    "PR": "Privately owned",
    "MA": "Military",
}


def fetch_rows(url):
    request = urllib.request.Request(url, headers={"User-Agent": "mapzimus/Motion airport-builder"})
    with urllib.request.urlopen(request, timeout=120) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    with archive.open("APT_BASE.csv") as source:
        text = io.TextIOWrapper(source, encoding="utf-8-sig", newline="")
        return list(csv.DictReader(text))


def clean_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, 1)


def feature(row):
    facility_type = FACILITY_TYPES.get(row["SITE_TYPE_CODE"], "Landing facility")
    public = row["FACILITY_USE_CODE"] == "PU"
    use = "Public use" if public else "Private use"
    ownership = OWNERSHIP_TYPES.get(row["OWNERSHIP_TYPE_CODE"], "Other ownership")
    identifiers = [row["ARPT_ID"]]
    if row["ICAO_ID"] and row["ICAO_ID"] not in identifiers:
        identifiers.append(row["ICAO_ID"])
    details = [
        f"{row['CITY'].title()}, {row['STATE_CODE']}",
        " / ".join(identifiers),
        ownership,
    ]
    elevation = clean_number(row["ELEV"])
    if elevation is not None:
        details.append(f"{elevation:g} ft elevation")
    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [float(row["LONG_DECIMAL"]), float(row["LAT_DECIMAL"])],
        },
        "properties": {
            "group": "airport",
            "dataStatus": "reference",
            "color": "#9be1ff",
            "title": row["ARPT_NAME"].title(),
            "status": f"{use} {facility_type.lower()}",
            "details": " · ".join(details),
            "provider": "FAA NASR 28-day subscription",
            "sourceUrl": SOURCE_PAGE,
            "faaId": row["ARPT_ID"],
            "icao": row["ICAO_ID"],
            "facilityType": facility_type,
            "facilityUse": "public" if public else "private",
            "state": row["STATE_CODE"].lower(),
            "county": row["COUNTY_NAME"].title(),
            "effectiveDate": row["EFF_DATE"],
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_APT_URL)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    rows = [
        row for row in fetch_rows(args.url)
        if row["STATE_CODE"] in NEW_ENGLAND
        and row["ARPT_STATUS"] == "O"
        and row["LAT_DECIMAL"]
        and row["LONG_DECIMAL"]
    ]
    features = sorted((feature(row) for row in rows), key=lambda item: item["properties"]["faaId"])
    public_count = sum(item["properties"]["facilityUse"] == "public" for item in features)
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "FAA 28-day NASR Airports and Other Landing Facilities (APT)",
            "sourceUrl": SOURCE_PAGE,
            "effectiveDate": rows[0]["EFF_DATE"] if rows else None,
            "count": len(features),
            "publicUseCount": public_count,
            "note": "Open FAA-listed facilities. Private-use facilities appear only at closer zooms.",
        },
        "features": features,
    }
    args.output.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(features)} facilities ({public_count} public use) to {args.output}")


if __name__ == "__main__":
    main()
