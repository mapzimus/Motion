# New England in Motion

One live map of transportation moving across Connecticut, Maine,
Massachusetts, New Hampshire, Rhode Island, and Vermont. Start with Boston,
switch to a single state, or zoom out to all New England.

The map combines MBTA vehicles and alerts, regional GTFS-realtime buses,
Amtrak, ADS-B aircraft, AIS harbor/coastal traffic, ferries, Bluebikes, and
TomTom road congestion. Live points are clipped to generalized 2025 U.S.
Census TIGERweb boundaries, so “Boston only” and state filters are geographic,
not guesses based on agency names.

## What works

| Layer | Source | Cadence |
|---|---|---|
| MBTA subway, Silver Line, buses, commuter rail, ferries | [MBTA V3 API](https://www.mbta.com/developers/v3-api) | 10 s |
| Regional buses | Agency GTFS-realtime feeds, normalized by the gateway | 20 s |
| Amtrak | [Amtraker](https://amtraker.com) community API | 90 s |
| Aircraft | [ADSB.lol](https://api.adsb.lol/) through the gateway | 45 s |
| Harbor/coastal vessels and identifiable passenger ferries | [AISStream](https://aisstream.io) through a protected WebSocket relay | streaming |
| Bluebikes stations | [Bluebikes GBFS](https://gbfs.bluebikes.com/gbfs/gbfs.json) | 60 s |
| Road congestion | [TomTom Traffic Flow](https://developer.tomtom.com/traffic-api) through protected raster tiles | live tiles |

The aircraft layer no longer calls airplanes.live. That service now rejects
this project with HTTP 403, and ADSB.lol does not expose browser CORS headers.
The Worker gateway fixes both problems without weakening browser security.

## Regional transit coverage

The gateway currently knows these vehicle-position feeds:

- Massachusetts: MBTA and Pioneer Valley Transit Authority; Merrimack Valley
  Transit is included through the optional Swiftly authorization
- Connecticut: CTtransit, HARTransit, River Valley Transit, and Norwalk
  Transit District
- Rhode Island: RIPTA
- Maine: Greater Portland METRO and Island Explorer
- New Hampshire/Vermont: Advance Transit plus Vermont's GMT, GMCN, Marble
  Valley, MOOver!, RCT, Tri-Valley, and The Current feeds

The NH/VT providers above use Swiftly's authorized realtime API. Their adapters
are included, but they report `needs-key` until `SWIFTLY_API_KEY` is configured.
Agencies that publish only schedules (static GTFS), use a closed tracker, or do
not expose a current vehicle feed are intentionally not drawn as “live.”

## Run the map

The MBTA, Amtrak, and Bluebikes layers work with only the static server:

```powershell
npm install
npm run dev
# http://localhost:5500
```

### Gateway setup

Aircraft and public regional-bus feeds need the gateway. AIS and traffic also
need their provider secrets.

```powershell
Copy-Item .dev.vars.example .dev.vars
# Edit .dev.vars; AIS/TomTom/Swiftly are optional for local development.
npm run gateway:dev
```

In a second terminal:

```powershell
npm run dev
# Open http://localhost:5500/?gateway=http://localhost:8787
```

The gateway URL persists in localStorage, so it only needs to be supplied once.
Provider keys never enter the page URL, localStorage, or the frontend bundle.

### Deploy the gateway

The Worker has separate staging and production environments. Create secrets in
the environment where they will be used:

```powershell
npx wrangler login
npx wrangler secret put AISSTREAM_API_KEY --env production
npx wrangler secret put TOMTOM_API_KEY --env production
npx wrangler secret put SWIFTLY_API_KEY --env production
npx wrangler deploy --env production
```

AISStream and TomTom are optional; omit those secrets if their layers should
stay unavailable. `SWIFTLY_API_KEY` must be the complete value expected by the
Swiftly `Authorization` header. Add any custom production frontend origin to
`ALLOWED_ORIGINS` in `wrangler.jsonc` before deployment.

## Gateway API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Configuration status without exposing secrets |
| `GET /api/planes?region=ma` | Deduplicated, normalized ADS-B aircraft |
| `GET /api/transit?region=ct` | Normalized GTFS-realtime bus positions and per-feed health |
| `GET /api/traffic/{z}/{x}/{y}.png` | Cached TomTom congestion tile |
| `GET /api/ais?region=new-england` with WebSocket upgrade | AISStream relay scoped to the selected region |

Supported region IDs are `boston`, `ma`, `ct`, `ri`, `nh`, `vt`, `me`, and
`new-england`. Browser origins are allowlisted. Provider responses are cached
briefly at the edge to avoid multiplying load.

## Architecture

```text
Public browser-safe APIs ───────────────┐
  MBTA · Amtraker · Bluebikes          │
                                       ├─ MapLibre fleets ─ Census region filter
Cloudflare Worker gateway ─────────────┘
  ADSB.lol · agency GTFS-RT · AISStream · TomTom
```

The frontend remains plain HTML/CSS/JavaScript. The gateway is TypeScript and
runs on Cloudflare Workers. Tests execute inside the Workers runtime with
Cloudflare's Vitest integration.

## Verify changes

```powershell
npm run check
npm test
npm run deploy:dry-run
```

## Remaining data gaps

- Many rural agencies publish schedules but no open live vehicle positions.
- Non-MBTA ferry operators generally publish schedules, not GTFS-realtime
  positions. AIS supplies actual vessel movement when a ship is broadcasting,
  and passenger-ship metadata is used to classify ferries when available.
- Traffic requires a TomTom key; New England 511 systems expose incidents and
  road conditions, but not one uniform public congestion-tile feed.
- Bluebikes is Boston-specific. Other New England GBFS systems can be added to
  the same bike adapter next.

Built by Max Howe — [github.com/mapzimus](https://github.com/mapzimus)
