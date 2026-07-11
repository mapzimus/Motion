# Boston in Motion

**A live map of Boston's entire MBTA rapid transit system.** Real-time positions,
service alerts, and crowding — polled straight from the MBTA V3 API and rendered
on a dark MapLibre basemap. No backend: the browser talks to the API directly.

> v1 of the [Boston Real-Time Transportation Map](https://github.com/mapzimus)
> portfolio project — one map that will eventually carry trains, buses, ferries,
> planes, harbor vessels, and road traffic as toggleable layers.

## Features (v1 — rapid transit)

- **Live vehicle positions** for all lines — Red, Orange, Blue, Green B/C/D/E,
  Mattapan Trolley, and all six Silver Line services — refreshed every 10 s and
  animated smoothly between updates
- Filters by **explicit route list, not GTFS mode**: the Silver Line is
  technically "bus" (route_type 3), but no Boston rapid-transit map is complete
  without it
- **Heading chevrons** show each train's direction of travel
- **Click any train** for destination, next stop, car number, crowding, and data age
- **Per-line toggles** with live train counts, plus a master subway switch
- **Service alerts** feed with severity badges on affected lines
- **Honest telemetry**: stale GPS fixes render dimmed; the status line shows
  live / paused / retrying states with exponential backoff
- Polling pauses when the tab is hidden (kind to the API, kind to batteries)

## Run it

```
node server.js        # -> http://localhost:5500
```

Any static file server works — there is no build step and no backend.
Deployment is copying these files to any static host (GitHub Pages, Vercel, …).

### API key (optional)

Anonymous access allows 20 requests/minute; this app uses ~7. For headroom,
grab a free key at [api-v3.mbta.com](https://api-v3.mbta.com) and either:

- append `?api_key=YOUR_KEY` to the URL, or
- set `API_KEY` in `js/config.js`

## Architecture

```
MBTA V3 API (JSON:API over HTTPS, CORS-open)
  /routes    -> line colors + destinations (fetched once; nothing hardcoded)
  /shapes    -> encoded polylines -> route ribbons     (once at load)
  /vehicles  -> positions/bearing/status/crowding      (every 10 s)
  /alerts    -> active service alerts                  (every 60 s)
        |
  js/api.js        flattens JSON:API -> plain objects
  js/vehicles.js   poller + easing animation between polls
  js/alerts.js     alert poller
  js/map.js        MapLibre layers: glow ribbons, dots, chevrons, popups
  js/ui.js         console panel: toggles, alert feed, status line
  js/config.js     every tunable knob in one place
```

## Roadmap

| Version | Layers | Source |
|---|---|---|
| **v1** ✅ | Subway + Silver Line | MBTA V3 API |
| v2 | Commuter rail, buses, ferries | same API — route list config change |
| v3 | Amtrak, planes (Logan), harbor vessels, road traffic | third-party APIs |
| future | All of New England | regional GTFS-RT feeds, 511 networks |

## Credits

Data: [MBTA V3 API](https://www.mbta.com/developers/v3-api) ·
Basemap: [CARTO Dark Matter](https://carto.com/basemaps/) © OpenStreetMap contributors ·
Map engine: [MapLibre GL JS](https://maplibre.org/)

Built by Max Howe — [github.com/mapzimus](https://github.com/mapzimus)
