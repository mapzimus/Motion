#!/usr/bin/env python3
"""Refresh scripts/feed-freshness.json without rebuilding route geometry.

build-regional-routes.py already writes the same file as a side output while it
has each GTFS zip open. Run this thin wrapper when you only want to know which
scheduled feeds are about to expire (for example before a release):

    py -3 -X utf8 scripts\\check-feed-freshness.py

It downloads every feed in regional-feeds.json (in parallel, each URL once),
records the last published service date, and exits non-zero when a feed that
is not `freshness_exempt` ends within the 7-day guard window enforced offline
by check-route-geometry.mjs.
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import io
import json
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

GUARD_DAYS = 7

_spec = importlib.util.spec_from_file_location(
    "build_regional_routes", Path(__file__).with_name("build-regional-routes.py")
)
build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build)


def fetch(url_and_agent):
    url, user_agent = url_and_agent
    try:
        archive = zipfile.ZipFile(io.BytesIO(build.download(url, user_agent)))
        end, source = build.service_end_date(archive)
        return {"serviceEnd": build.iso_date(end), "source": source}
    except Exception as error:  # report every feed instead of stopping at the first
        return {"error": str(error)}


def main() -> int:
    feeds = json.loads(build.CONFIG_PATH.read_text(encoding="utf-8"))
    keys = sorted({(feed["url"], feed.get("user_agent")) for feed in feeds}, key=str)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(zip(keys, pool.map(fetch, keys)))
    records = {}
    for feed in feeds:
        result = results[(feed["url"], feed.get("user_agent"))]
        records[feed["id"]] = result if "error" in result else {**result, "url": feed["url"]}
    build.write_feed_freshness(records, feeds)

    written = json.loads(build.FRESHNESS_PATH.read_text(encoding="utf-8"))
    cutoff = (dt.date.fromisoformat(written["checkedAt"]) + dt.timedelta(days=GUARD_DAYS)).isoformat()
    stale = []
    for feed in feeds:
        record = written["feeds"][feed["id"]]
        end = record.get("serviceEnd")
        note = f"  (exempt: {record['exempt']})" if record.get("exempt") else ""
        error = f"  [download failed: {record['lastError']}]" if record.get("lastError") else ""
        print(f"{feed['id']:<28} {end or 'unknown':<12}{note}{error}")
        if not record.get("exempt") and (not end or end < cutoff):
            stale.append(feed["id"])
    print(f"Wrote {build.FRESHNESS_PATH}")
    if stale:
        print(f"Service ends before {cutoff} (or is unknown) for: {', '.join(stale)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
