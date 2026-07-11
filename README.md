# Boston in Motion

**One live map of everything moving through Boston.** Subway trains, commuter
rail, buses, ferries, Amtrak, aircraft over Logan, and real harbor traffic —
all polled or streamed straight into the browser and rendered on a dark
MapLibre basemap. No backend at all.

## Layers

| Layer | Source | Cadence |
|---|---|---|
| Subway (Red/Orange/Green/Blue), Silver Line, Mattapan Trolley | [MBTA V3 API](https://www.mbta.com/developers/v3-api) | 10 s |
| Commuter Rail (13 lines) | MBTA V3 API — same single request | 10 s |
| Bus network (~150 routes) | MBTA V3 API — same single request | 10 s |
| MBTA Ferries (8 routes) | MBTA V3 API — same single request | 10 s |
| Amtrak (trains inside the map region) | [Amtraker API](https://amtraker.com) (community, keyless) | 90 s |
| Planes (30 nm around Logan) | [airplanes.live](https://airplanes.live) ADS-B (community, keyless) | 45 s |
| Harbor traffic (live AIS) | [aisstream.io](https://aisstream.io) WebSocket — needs free key | streaming |
| Road traffic | — | planned |

The entire MBTA fleet (~500-900 vehicles) arrives in **one** `/vehicles`
request per poll, classified into layers client-side. The Silver Line is
GTFS-type "bus", but no Boston rapid-transit map is complete without it, so
it rides with the subway group.

## Features

- Vehicles glide between polls instead of teleporting; chevrons show heading
- Click anything — train, bus, ferry, plane, ship — for destination, next stop
  / altitude / speed, car number, crowding, and data age
- **Click a service alert to fly the map to the affected stops** (red ping)
- Per-line subway toggles + per-mode toggles, with live counts
- Alert feed with severity badges on affected lines; routine single-bus-route
  alerts are filtered out unless severe
- Honest telemetry: stale fixes render dimmed; status line shows
  live / paused / retrying with exponential backoff; polling pauses in hidden tabs
- Route ribbons for rail/SL/ferry cached locally for 24 h (buses stay
  ribbon-free on purpose — 150 overlapping routes would bury the map)

## Run it

```
node server.js        # -> http://localhost:5500
```

Any static file server works — there is no build step and no backend.
Deployment is copying these files to any static host (GitHub Pages, Vercel, …).

### Keys

- **MBTA** — a key ships in `js/config.js` (rate-limit-only, no billing,
  regenerate anytime at [api-v3.mbta.com](https://api-v3.mbta.com)). Override
  with `?api_key=YOUR_KEY`.
- **Live harbor traffic (AIS)** — needs a free [aisstream.io](https://aisstream.io)
  key (GitHub sign-in). Either paste it into `AIS_KEY` in `js/config.js`, or
  visit once with `?ais_key=YOUR_KEY` — it persists in that browser via
  localStorage. Until then the layer shows a "free key" link; MBTA ferries
  still appear regardless. Note: MBTA ferries also broadcast AIS, so with both
  layers on, a ferry can appear twice (two independent sources).

## Architecture

```
MBTA V3 API ──── /routes /shapes /vehicles /alerts /stops   (poll)
Amtraker ─────── all US trains, filtered to the map region  (poll)
airplanes.live ─ ADS-B aircraft within 30 nm of Logan       (poll)
aisstream.io ─── AIS position reports over WebSocket        (stream)
        │
  js/api.js      MBTA JSON:API -> plain objects (sparse fieldsets)
  js/mbta.js     one-request full-fleet poller + group classifier
  js/amtrak.js   Amtrak poller          js/planes.js  ADS-B poller
  js/ais.js      AIS stream -> roster   js/alerts.js  alerts + stop coords
  js/fleet.js    generic animated fleet (glide between updates)
  js/map.js      MapLibre: ribbons, fleet layers, popups, alert fly-to
  js/ui.js       console panel: toggles, alert feed, status line
  js/config.js   every tunable knob in one place
```

## Roadmap

| Version | Scope | Status |
|---|---|---|
| v1 | Subway + Silver Line, live map, alerts | ✅ |
| v2 | Commuter rail, buses, ferries | ✅ |
| v3 | Amtrak, planes, harbor AIS, alert→map focus | ✅ |
| v4 | Road traffic layer, all-of-New-England expansion | planned |

## Credits

Data: [MBTA V3 API](https://www.mbta.com/developers/v3-api) ·
[Amtraker](https://amtraker.com) · [airplanes.live](https://airplanes.live) ·
[aisstream.io](https://aisstream.io) ·
Basemap: [CARTO Dark Matter](https://carto.com/basemaps/) © OpenStreetMap contributors ·
Map engine: [MapLibre GL JS](https://maplibre.org/)

Built by Max Howe — [github.com/mapzimus](https://github.com/mapzimus)
