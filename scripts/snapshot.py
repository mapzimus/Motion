"""Read the scheduled-route snapshot that build-regional-routes.py writes.

The snapshot is split into one GeoJSON file per top-level area (a state such
as ``ma`` or ``ny``, or a metro such as ``philadelphia``) under
``public/data/routes/``, plus ``index.json`` listing them with the build
metadata. A route that touches several areas is written to each of their
files, so readers dedupe on the ``fid`` property. ``load_snapshot()`` returns
the whole thing as one FeatureCollection, the shape every script here expects.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROUTES_DIR = ROOT / "public" / "data" / "routes"
INDEX_PATH = ROUTES_DIR / "index.json"


def load_snapshot(routes_dir: Path = ROUTES_DIR) -> dict:
    index = json.loads((routes_dir / "index.json").read_text(encoding="utf-8"))
    features = {}
    for area in index.get("areas", []):
        part = json.loads((routes_dir / area["file"]).read_text(encoding="utf-8"))
        for feature in part.get("features", []):
            features.setdefault(feature.get("properties", {}).get("fid"), feature)
    return {
        "type": "FeatureCollection",
        "metadata": index.get("metadata", {}),
        "features": list(features.values()),
    }
