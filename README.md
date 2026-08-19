# New England in Motion

One live map of transportation moving across Connecticut, Maine,
Massachusetts, New Hampshire, Rhode Island, and Vermont. Start with Boston,
switch to a single state, or zoom out to all New England.

The map combines MBTA vehicles and alerts, regional transit routes and live
positions, Amtrak, ADS-B aircraft, AIS harbor/coastal traffic, ferries, shared
bikes and scooters, Massachusetts road work, and optional live congestion.
Live points are clipped to generalized 2025 U.S. Census TIGERweb boundaries,
so “Boston only” and state filters are geographic, not guesses based on agency
names.

## What works

| Layer | Source | Cadence |
|---|---|---|
| MBTA subway, Silver Line, buses, commuter rail, ferries | [MBTA V3 API](https://www.mbta.com/developers/v3-api) | 10 s |
| Regional buses | Agency GTFS-realtime feeds, normalized by the gateway | 20 s |
| Metro-North New Haven branches | [MTA GTFS-Realtime](https://www.mta.info/developers) trip predictions and alerts; positions are explicitly estimated between stations | 30 s |
| Scheduled bus, rail, ferry, and passenger-boat routes | 55 static GTFS sources plus nine official-schedule corridors, including Metro-North, Concord Coach, Dartmouth Coach, Greyhound/FlixBus, Lake Champlain Ferries, and Lake Winnipesaukee services | built snapshot |
| Amtrak | [Amtraker](https://amtraker.com) community API | 90 s |
| Aircraft | [ADSB.lol](https://api.adsb.lol/) with [adsb.fi](https://adsb.fi/) failover; click a plane for its best-effort origin and destination | 45 s |
| Harbor/coastal vessels and identifiable passenger ferries | [AISStream](https://aisstream.io) through a protected WebSocket relay | streaming |
| Bike and scooter share | GBFS feeds for Bluebikes across 13 Greater Boston municipalities, Veo Hartford, Veo New Haven, and Spin Providence | 60 s |
| Road work | [MassDOT WZDx](https://feed.massdot-swzm.com/) | 60 s |
| Live congestion speeds | [TomTom Traffic Flow](https://developer.tomtom.com/traffic-api) through protected raster tiles | optional live tiles |

The aircraft layer no longer calls airplanes.live. That service now rejects
this project with HTTP 403, and ADS-B providers do not expose browser CORS
headers. The server-side aircraft relay fixes both problems without weakening
browser security, fails over from ADSB.lol to adsb.fi, and uses CDN stale-
while-revalidate caching to keep the last good positions during a provider
interruption.

Aircraft origin and destination are resolved only after a plane is clicked.
The lookup is a best-effort callsign match against ADSB.lol's route catalog;
private, repositioning, and irregular flights may not have an itinerary.

## Regional transit coverage

The checked-in route snapshot contains 947 bus, commuter-rail, ferry, and
passenger-boat route features assembled from 55 static GTFS sources plus nine
official-schedule corridors. Scheduled routes remain visible when an operator
publishes no live positions. State views start with the scheduled bus layer on,
and the sidebar reports scheduled route counts separately from live vehicles,
so a missing realtime credential no longer makes service look absent.
Metro-North's New Haven, New Canaan, Danbury, and Waterbury lines are included
in Connecticut; connected routes are allowed to continue outside the selected
boundary so riders can see the full trip into New York City.

Concord Coach's seven intercity routes use a community-maintained GTFS feed
cataloged and continuously validated by Transitland. Greyhound and FlixBus use
their current official U.S. GTFS feed; the build keeps only trip patterns that
actually touch a New England state. Dartmouth Coach does not publish a
discoverable GTFS feed, so its Upper Valley–Boston/Logan and Upper Valley–NYC
corridors follow the stop order on the carrier's official schedules and link
back to those schedules from the map popup. These intercity carriers are shown
as schedules, not invented live vehicle positions.

Vermont includes 98 scheduled bus routes in the current snapshot, including 16
Green Mountain Transit routes, Vermont Translines, and intercity Greyhound/
FlixBus connections. Lake Champlain's current Grand Isle–Plattsburgh and
Charlotte–Essex crossings are included. In New Hampshire, the ferry/passenger-
boat layer also includes published 2026 Mount Washington Cruises corridors and
the seasonal Sophie C island mailboat itinerary on Lake Winnipesaukee. These
inland-water lines are schedule context; AIS may add a live marker only when a
vessel is independently broadcasting and received by the configured provider.

Bluebikes is a Greater Boston system rather than a statewide brand. Its public
feed covers Arlington, Boston, Brookline, Cambridge, Chelsea, Everett, Malden,
Medford, Newton, Revere, Salem, Somerville, and Watertown. The same regional
layer also includes the separately operated Hartford, New Haven, and Providence
systems. No discoverable public GBFS system is currently cataloged for Vermont,
New Hampshire, or Maine, so the map does not fabricate stations there.

Metro-North is different: the MTA publishes keyless realtime trip updates and
alerts, but not GPS vehicle positions. Motion interpolates active New Haven,
New Canaan, Danbury, and Waterbury trains between their reported stations and
labels every popup “Estimated position from MTA trip updates.”

The gateway currently knows these live vehicle-position feeds:

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
Agencies that publish only schedules, use a closed tracker, or do not expose a
current vehicle feed still appear as scheduled route ribbons, but are not
misrepresented as live dots.

Rebuild the static route snapshot after agencies update their schedules:

```powershell
py -3 -X utf8 scripts\build-regional-routes.py
```

## Run the map

The MBTA, Amtrak, regional route, and shared-mobility layers work with only the
static server:

```powershell
npm install
npm run dev
# http://localhost:5500
```

### Gateway setup

Aircraft and public regional-bus feeds need a gateway. Massachusetts road work
is keyless. AIS and live congestion need provider secrets. The live site uses
the deployed gateway at
`https://motion-gateway.mapzimus.workers.dev` and the aircraft relay at
`https://motion-aircraft-gateway.vercel.app` automatically.

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

Local gateway overrides persist in localStorage, so they only need to be
supplied once. Provider keys never enter the page URL, localStorage, or the
frontend bundle.

The `aircraft-gateway/` Vercel Function gives the aircraft feed separate
outbound networking because both public ADS-B providers rate-limit or block
Cloudflare's shared Worker egress. Successful responses are cached for 30
seconds and can be served stale for five minutes while a refresh retries.

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

Deploy the separate aircraft relay from its own project directory:

```powershell
Set-Location aircraft-gateway
npx vercel link --yes --project motion-aircraft-gateway
npx vercel --prod --yes
```

## Gateway API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Configuration status without exposing secrets |
| `GET /api/planes?region=ma` | Deduplicated, normalized ADS-B aircraft |
| `GET /api/route?callsign=AAL108` | Best-effort aircraft origin and destination (Vercel relay) |
| `GET /api/transit?region=ct` | Normalized GTFS-realtime bus positions and per-feed health |
| `GET /api/mnr` | Metro-North active trip segments and service alerts from official MTA GTFS-Realtime |
| `GET /api/roadwork` | Active and upcoming MassDOT WZDx road-work geometry |
| `GET /api/traffic/{z}/{x}/{y}.png` | Cached TomTom congestion tile |
| `GET /api/ais?region=new-england` with WebSocket upgrade | AISStream relay scoped to the selected region |

Supported region IDs are `boston`, `ma`, `ct`, `ri`, `nh`, `vt`, `me`, and
`new-england`. Browser origins are allowlisted. Provider responses are cached
briefly at the edge to avoid multiplying load.

## Architecture

```text
Public browser-safe APIs ───────────────┐
  MBTA · static GTFS · Amtraker · GBFS │
                                       ├─ MapLibre fleets ─ Census region filter
Cloudflare Worker gateway ─────────────┤
  agency GTFS-RT · MTA MNR · MassDOT · AIS · TomTom│
Vercel aircraft relay ─────────────────┘
  ADSB.lol · adsb.fi · route lookup
```

The frontend remains plain HTML/CSS/JavaScript. The gateways are TypeScript and
run on Cloudflare Workers and Vercel Functions. Cloudflare gateway tests execute
inside the Workers runtime with Cloudflare's Vitest integration.

## Verify changes

```powershell
npm run check
npm test
npm run deploy:dry-run
```

## Remaining data gaps

- Many rural agencies publish schedules but no open live vehicle positions.
- Metro-North train locations are estimates between realtime station
  predictions, not direct train GPS coordinates.
- Non-MBTA ferry operators generally publish schedules, not GTFS-realtime
  positions. AIS supplies actual vessel movement when a ship is broadcasting,
  and passenger-ship metadata is used to classify ferries when available.
- Massachusetts work zones are keyless, but continuous congestion speeds still
  need a traffic data source. New England 511 systems expose incidents and road
  conditions, but not one uniform, keyless congestion-speed feed.
- Current GBFS coverage is Bluebikes' 13 Greater Boston municipalities plus
  Hartford, New Haven, and Providence. Other systems can be added as soon as
  they publish discoverable public feeds.

Built by Max Howe — [github.com/mapzimus](https://github.com/mapzimus)
