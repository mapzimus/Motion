# New England in Motion

One live map of transportation moving across Connecticut, Maine,
Massachusetts, New Hampshire, Rhode Island, and Vermont. Start with Boston,
switch to a single state, or zoom out to all New England.

The map combines live and scheduled public transportation, aircraft, boats,
shared mobility, traffic, road events, public traffic cameras, major roads,
freight rail, and walking/cycling networks. Live points are clipped to
generalized 2025 U.S. Census TIGERweb boundaries, so “Boston only,” each state,
and “All New England” are geographic filters rather than agency-name guesses.
Every feature is labeled **live**, **estimated**, **scheduled**, or
**reference** so a published route never masquerades as a moving vehicle.

## What works

| Layer | Source | Cadence |
|---|---|---|
| MBTA subway, Silver Line, buses, commuter rail, ferries | [MBTA V3 API](https://www.mbta.com/developers/v3-api) | 10 s |
| Regional buses | Agency GTFS-realtime feeds, normalized by the gateway | 20 s |
| Metro-North New Haven branches | [MTA GTFS-Realtime](https://www.mta.info/developers) trip predictions and alerts; positions are explicitly estimated between stations | 30 s |
| Scheduled/reference bus, rail, ferry, boat, and air-service routes | 70 GTFS sources plus 85 official-service corridors, including Amtrak, Metro-North, regional coaches, 93 ferry routes, municipal water shuttles, small-island lifelines, and island air taxis | built snapshot |
| Small-town, county, flex, volunteer, microtransit, and on-demand water-service catalog | 53 official-directory service markers across all six states | built snapshot |
| Amtrak | [Amtrak official static GTFS](https://content.amtrak.com/content/gtfs/GTFS.zip) for scheduled routes/stations; [Amtraker](https://amtraker.com) community API for live trains | built snapshot + 90 s |
| Aircraft and air services | [ADSB.lol](https://api.adsb.lol/) with [adsb.fi](https://adsb.fi/) failover; 11 optional official Cape Air/Tradewind schedules and Penobscot Island Air on-demand corridors | 45 s + built snapshot |
| Airports and landing facilities | 778 open airports, heliports, seaplane bases, and other facilities from the [FAA NASR subscription](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/) | 28-day built snapshot |
| Harbor/coastal vessels and identifiable passenger ferries | [AISStream](https://aisstream.io) through a protected WebSocket relay | streaming |
| Bike and scooter share | GBFS feeds for Bluebikes across 13 Greater Boston municipalities, Veo Hartford, Veo New Haven, and Spin Providence | 60 s |
| Work zones and closures | MassDOT WZDx plus the multi-state New England 511 WZDx feed for Maine, New Hampshire, and Vermont | 60 s |
| Traffic incidents and public cameras | New England 511, CTroads, and the MassDOT CCTV asset inventory | 60–90 s |
| Live congestion speeds | Public 511 traffic-flow tiles through the gateway; TomTom remains an optional configured fallback | live tiles |
| Major roads and freight rail | U.S. Census TIGERweb primary roads and the FRA North American Rail Network | built snapshot |
| Canada border crossings | 38 road, rail, ferry, and remote-traveller facilities from the [CBSA Directory of Offices](https://www.cbsa-asfc.gc.ca/do-rb/menu-eng.html) | built snapshot |
| Marked walking and cycling routes | OpenStreetMap route relations via Waymarked Trails | live map tiles |

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

The checked-in route snapshot contains 1,098 bus, commuter-rail, Amtrak,
ferry, passenger-boat, and air-service route features plus 53 New England
Amtrak stations, assembled from 70 GTFS sources and 85 official-service
corridors. Scheduled
routes remain visible when an operator publishes no live positions. State
views start with the scheduled bus layer on,
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

Vermont includes regional routes from every discoverable public GTFS source in
the current audit, including Green Mountain Transit, Vermont Translines, and
intercity Greyhound/FlixBus connections. Official Amtrak schedule data adds
the Vermonter and Ethan Allen Express as persistent rail-following ribbons and
all 14 Vermont stations. Burlington Union Station (`BTN`) is kept distinct
from Essex Junction–Burlington (`ESX`) because they serve different routes.
Amtraker remains the separately attributed community source for live train
positions. Lake Champlain's current Grand Isle–Plattsburgh and Charlotte–Essex
crossings are joined by the seasonal Shoreham–Ticonderoga ferry. Lake Champlain
Transportation does not currently list Burlington–Port Kent as an operating
crossing, so Burlington is not given a fictional ferry line. The map instead
marks Burlington's real Spirit of Ethan Allen and Buttercup passenger cruises,
the Inland Sea's on-demand Spring Beach Ferry, and Vermont State Parks'
restricted 2026 Kill Kare–Burton Island passenger ferry. New Hampshire
includes both public Star Island approaches, published 2026 Mount Washington
Cruises corridors, and the Sophie C island mailboat itinerary on Lake
Winnipesaukee. Maine includes the six state-ferry links plus Chebeague, Isle au
Haut, Monhegan, the Cranberry Isles, Schoodic, Eastport–Lubec, Frye Island,
Swan Island WMA, Mount Kineo, and The CAT to Nova Scotia.

Connecticut coverage now includes all four current regional Long Island Sound
connections: New London–Orient Point, Bridgeport–Port Jefferson, New
London–Montauk, and New London–Fishers Island, plus Block Island, both state
river ferries, and municipal island/water-taxi services. Rhode Island adds
Prudence Island, Providence–Bristol–Newport, Newport–Block Island, and the
Jamestown/Newport harbor network. Massachusetts adds the non-MBTA Boston
Seaport routes, Seastreak's three South Coast/islands corridors, Island Queen,
Patriot, Pied Piper, Chappy Ferry, Harwich–Nantucket, two additional
Provincetown services, and smaller public harbor and island shuttles. Each
official-schedule popup identifies its service type and season and labels the
line as an approximate water path rather than a live vessel track. AIS may add
a live marker only when a vessel is independently broadcasting and received by
the configured provider. Every generated ferry path is audited against the
full-resolution GSHHG shoreline hierarchy and Census TIGERweb areal
hydrography. All ferry coordinate fingerprints are locked by the geometry
check, so a feed update or manual edit cannot silently restore an over-land
ocean, lake, harbor, or river chord.
The active MBTA `Boat-Lynn` feed supplies Lynn–Boston service directly, while
the seasonal Salem–Boston Long Wharf service is retained as an explicit
official-schedule corridor so it remains visible without live vessel data.

Bluebikes is a Greater Boston system rather than a statewide brand. Its public
feed covers Arlington, Boston, Brookline, Cambridge, Chelsea, Everett, Malden,
Medford, Newton, Revere, Salem, Somerville, and Watertown. The same regional
layer also includes the separately operated Hartford, New Haven, and Providence
systems. No discoverable public GBFS system is currently cataloged for Vermont,
New Hampshire, or Maine, so the map does not fabricate stations there.

The **Local & on-demand services** layer fills a different gap. It currently
catalogs 53 services that do not have reliable route geometry or public live
positions: Maine county transportation, Sullivan County and New Hampshire
community providers, Massachusetts microtransit, Connecticut's nine CTDOT
microtransit programs, RIPTA Flex zones, Vermont's regional demand-response
providers, and on-demand Boston Harbor and Maine coastal water taxis. These
are service-area reference points with links
to the official provider—not pretend bus paths.

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

Some intercity GTFS files publish only terminal stops or incomplete shapes.
The snapshot builder replaces bus gaps longer than 20 km with a cached,
approximate road-following path from OpenStreetMap/Project OSRM. These repairs
run only at build time, remain labeled approximate in the popup, and never make
network requests from a visitor's browser. Amtrak's build uses only official
nonempty rail shapes and never substitutes straight stop-to-stop lines. A
geometry check prevents a future feed update from restoring a map-spanning
straight bus or Amtrak line.

Rebuild the static route snapshot after agencies update their schedules:

```powershell
py -3 -X utf8 scripts\build-regional-routes.py
py -3 -X utf8 scripts\build-airports.py
py -3 -X utf8 scripts\build-border-crossings.py
```

Normal rebuilds make no road-router requests: that portion uses the checked-in
cache. The builder still downloads each agency's current GTFS schedule, so the
route snapshot can change when a provider updates its feed. A maintainer can
explicitly fetch generic road geometry for newly discovered long gaps (at a
rate limited to the public router's usage guidance), then review and commit the
updated cache:

```powershell
py -3 -X utf8 scripts\build-regional-routes.py --update-road-cache
```

Reviewed interstate controls keep New York-bound coaches off bus-restricted
Connecticut and New York parkways. Use `--refresh-road-cache` when those
controls or the routing method change and every cached repair must be
regenerated. The geometry check rejects long chords, loops, stale cache
entries, and excessive road detours before a release.

Approximate repaired geometry is derived from
[OpenStreetMap contributors](https://www.openstreetmap.org/copyright) using the
[Project OSRM route service](https://project-osrm.org/docs/v5.7.0/api/); an
operator's actual roadway may vary.

The **Airports & landing facilities** layer includes public and private FAA
facilities, with private sites held back until a closer zoom. The air-service
ribbons distinguish scheduled Cape Air/Tradewind routes from Penobscot Island
Air's on-demand links between Knox County Regional Airport and Matinicus,
Vinalhaven, North Haven, and Islesboro. Those lines show service relationships,
not actual or live flight tracks, and start switched off so they do not obscure
surface and water routes or live aircraft.

The **Canada border crossings** layer uses the current CBSA office directory
for New England's Maine, New Hampshire, and Vermont frontier. It includes
ordinary roads, rail inspection points, the Campobello–Lubec crossing, and
remote-traveller pilot facilities. Canadian-side control points retain their
adjacent U.S. state tag, so state filters keep the correct crossings in view.

## Run the map

The MBTA, Amtrak, regional route, and shared-mobility layers work with only the
static server:

```powershell
npm install
npm run dev
# http://localhost:5500
```

### Gateway setup

Aircraft, public regional-bus feeds, road events, cameras, and traffic tiles
use a gateway. The public 511 sources are keyless; AIS and some optional
regional realtime adapters need provider credentials. The live site uses
the deployed gateway at
`https://motion-gateway.mapzimus.workers.dev` and the aircraft relay at
`https://motion-aircraft-gateway.vercel.app` automatically.

```powershell
Copy-Item .dev.vars.example .dev.vars
# Edit .dev.vars; AIS, TomTom, and Swiftly are all optional.
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

AISStream, TomTom, and Swiftly are optional. Without TomTom the traffic layer
uses public New England 511 tiles. `SWIFTLY_API_KEY` must be the complete value expected by the
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
| `GET /api/roadwork` | Active/upcoming MassDOT and northern New England WZDx geometry |
| `GET /api/road-events` | Official New England 511 and CTroads incidents |
| `GET /api/cameras` | Public camera locations from 511, CTroads, and MassDOT |
| `GET /api/camera-detail?provider=north&id=…` | Latest public 511 camera image and official viewer details |
| `GET /api/traffic/{z}/{x}/{y}.png` | Cached public 511 congestion tile, with optional TomTom source |
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
  agency GTFS-RT · MTA MNR · 511 · WZDx · cameras · AIS│
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
- Work-zone geometry is currently strongest in Massachusetts, Maine, New
  Hampshire, and Vermont. Connecticut and Rhode Island road disruptions still
  appear through their public incident/event feeds rather than a uniform WZDx
  layer.
- Current GBFS coverage is Bluebikes' 13 Greater Boston municipalities plus
  Hartford, New Haven, and Providence. Other systems can be added as soon as
  they publish discoverable public feeds.
- Public truck, delivery, and company-fleet positions are generally private
  telematics, and there is no national public live freight-train position feed.
  Motion maps the public FRA rail network instead of claiming scheduled or
  live freight locations it cannot verify.
- Flock/ALPR camera locations and live emergency-responder positions are not
  collected. Motion uses official public traffic cameras and public 511
  incidents without turning the map into a surveillance or responder-tracking
  tool.

Built by Max Howe — [github.com/mapzimus](https://github.com/mapzimus)
