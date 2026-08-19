"""Build compact, clickable New England road and rail infrastructure GeoJSON.

Sources are the official Census TIGERweb primary-road service and FRA's
National Transportation Atlas Database rail network. The output is checked in
so the browser does not make thousands of ArcGIS requests.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "infrastructure.geojson"
NEW_ENGLAND_BBOX = "-73.8,40.9,-66.7,47.6"
ROAD_LAYER = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "TIGERweb/Transportation/MapServer/1/query"
)
RAIL_LAYER = (
    "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/"
    "NTAD_North_American_Rail_Network_Lines/FeatureServer/0/query"
)
ROAD_SOURCE = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "TIGERweb/Transportation/MapServer/1"
)
RAIL_SOURCE = (
    "https://railroads.fra.dot.gov/rail-network-development/maps-and-data/"
    "maps-geographic-information-system/maps-geographic"
)


def fetch_geojson(base: str, params: dict[str, object]) -> dict:
    url = f"{base}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": "Motion map data builder"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)


def road_features() -> list[dict]:
    collection = fetch_geojson(
        ROAD_LAYER,
        {
            "where": "1=1",
            "geometry": NEW_ENGLAND_BBOX,
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "NAME,MTFCC,RTTYP",
            "returnGeometry": "true",
            "outSR": 4326,
            "maxAllowableOffset": 0.00025,
            "geometryPrecision": 5,
            "f": "geojson",
        },
    )
    output = []
    for index, feature in enumerate(collection.get("features", [])):
        properties = feature.get("properties") or {}
        name = properties.get("NAME") or "Primary roadway"
        route_type = properties.get("RTTYP") or ""
        route_labels = {
            "I": "Interstate highway",
            "U": "U.S. highway",
            "S": "State route",
        }
        feature["id"] = f"road-{index}"
        feature["properties"] = {
            "group": "roads",
            "dataStatus": "reference",
            "color": "#8a949f",
            "title": name,
            "status": route_labels.get(route_type, "Primary roadway"),
            "details": "Official primary-road reference geometry; traffic speeds are a separate live layer.",
            "provider": "U.S. Census Bureau TIGERweb",
            "sourceUrl": ROAD_SOURCE,
        }
        output.append(feature)
    return output


def rail_features() -> list[dict]:
    output: list[dict] = []
    offset = 0
    page_size = 2000
    while True:
        collection = fetch_geojson(
            RAIL_LAYER,
            {
                "where": (
                    "STATEAB IN ('CT','MA','ME','NH','RI','VT') "
                    "AND NET IN ('M','I','S')"
                ),
                "outFields": (
                    "FRAARCID,STATEAB,RROWNER1,DIVISION,SUBDIV,BRANCH,"
                    "YARDNAME,PASSNGR,STRACNET,TRACKS,MILES,NET"
                ),
                "returnGeometry": "true",
                "outSR": 4326,
                "maxAllowableOffset": 0.0002,
                "geometryPrecision": 5,
                "resultOffset": offset,
                "resultRecordCount": page_size,
                "f": "geojson",
            },
        )
        page = collection.get("features", [])
        for feature in page:
            properties = feature.get("properties") or {}
            owner = str(properties.get("RROWNER1") or "Rail network")
            subdivision = str(properties.get("SUBDIV") or properties.get("BRANCH") or "").strip()
            yard = str(properties.get("YARDNAME") or "").strip()
            tracks = properties.get("TRACKS")
            miles = properties.get("MILES")
            network_type = {
                "M": "main rail network",
                "I": "major industrial lead",
                "S": "passing siding",
            }.get(str(properties.get("NET") or ""), "rail infrastructure")
            status = [
                f"{properties.get('STATEAB', '')} {network_type}".strip(),
                f"{tracks} track{'s' if tracks != 1 else ''}" if tracks not in (None, "") else "",
                f"{float(miles):.1f} mi segment" if miles not in (None, "") else "",
            ]
            title_parts = [owner, subdivision, yard]
            feature["id"] = f"rail-{properties.get('FRAARCID', len(output))}"
            feature["properties"] = {
                "group": "freight",
                "dataStatus": "reference",
                "color": "#b98b72",
                "title": " · ".join(part for part in title_parts if part),
                "status": " · ".join(part for part in status if part),
                "details": (
                    "FRA rail network reference. Freight and passenger operators may share track; "
                    "there is no national public live freight-train position feed."
                ),
                "provider": "Federal Railroad Administration · NTAD",
                "sourceUrl": RAIL_SOURCE,
            }
            output.append(feature)
        offset += len(page)
        if len(page) < page_size:
            break
    return output


def main() -> None:
    roads = road_features()
    rails = rail_features()
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "builtFrom": [ROAD_SOURCE, RAIL_SOURCE],
            "note": "Reference infrastructure, not live vehicle positions",
        },
        "features": roads + rails,
    }
    OUTPUT.write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT}: {len(roads)} roads, {len(rails)} rail segments")


if __name__ == "__main__":
    main()
