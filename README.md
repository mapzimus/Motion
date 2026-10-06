# New England in Motion

One live map of transportation moving across Connecticut, Maine,
Massachusetts, New Hampshire, Rhode Island, and Vermont. Start with Greater
Boston (the 128 cities and towns inside I-495), narrow to the 17-municipality
MBTA core, pick one of 28 named regions such as the North Shore, Cape Cod &
Islands, the Pioneer Valley, the Northeast Kingdom or Midcoast Maine, switch to a single state, or zoom out to all
New England.

The map combines live and scheduled public transportation, aircraft, boats,
shared mobility, traffic, road events, public traffic cameras, major roads,
freight rail, and walking/cycling networks. Live points are clipped to
generalized U.S. Census TIGERweb boundaries, so Greater Boston, the MBTA core,
every named region, each state, and “All New England” are geographic filters
rather than agency-name guesses.
Every feature is labeled **live**, **estimated**, **scheduled**, or
**reference** so a published route never masquerades as a moving vehicle.

## What works

| Layer | Source | Cadence |
|---|---|---|
| MBTA subway, Silver Line, buses, commuter rail, ferries | [MBTA V3 API](https://www.mbta.com/developers/v3-api) | 10 s |
| Regional buses | Agency GTFS-realtime feeds, normalized by the gateway | 20 s |
| Metro-North New Haven branches | [MTA GTFS-Realtime](https://www.mta.info/developers) train GPS positions, trip predictions, and alerts; a train with no fresh GPS fix is estimated between stations and labeled so | 30 s |
| Scheduled/reference bus, rail, ferry, boat, and air-service routes and stops | 104 GTFS sources plus 81 official-service corridors, including Amtrak, Metro-North, Shore Line East, regional coaches, university shuttles, 93 ferry routes, municipal water shuttles, small-island lifelines, island air taxis, and 38,000+ scheduled stops | built snapshot |
| Small-town, county, flex, volunteer, microtransit, and on-demand water-service catalog | 51 official-directory service markers across all six states | built snapshot |
| Taxi and cab services | 106 licensed cab companies, dispatch associations, and official airport and station taxi stands from state and municipal licensing lists, airport ground-transportation pages, and operator sites, plus 30 [OpenStreetMap](https://www.openstreetmap.org/copyright) taxi stands. A directory, not live cab positions | built snapshot |
| Amtrak | [Amtrak official static GTFS](https://content.amtrak.com/content/gtfs/GTFS.zip) for scheduled routes/stations; [Amtraker](https://amtraker.com) community API for live trains | built snapshot + 90 s |
| Aircraft and air services | [ADSB.lol](https://api.adsb.lol/) with [adsb.fi](https://adsb.fi/) failover; 18 optional official Cape Air/Tradewind schedules and Penobscot Island Air on-demand corridors | 45 s + built snapshot |
| Airports and landing facilities | 778 open airports, heliports, seaplane bases, and other facilities from the [FAA NASR subscription](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/) | 28-day built snapshot |
| Harbor/coastal vessels and identifiable passenger ferries | [AISStream](https://aisstream.io) through a protected WebSocket relay | streaming |
| Bike and scooter share | GBFS feeds for Bluebikes across 13 Greater Boston municipalities, Veo Hartford, Veo New Haven, and Spin Providence | 60 s |
| Other bike-share systems | 50 reference markers for ValleyBike Share, Rideable Nashua, Portland Bike Share, Port Bikeshare, Minuteman Bikeshare, CATMA's Bird e-bikes, CargoB, Metro Mobility, the Community Pedal Power library, Coast Provincetown, and Sandy Pedals — systems with no usable public GBFS feed | built snapshot |
| Work zones and closures | MassDOT WZDx plus the multi-state New England 511 WZDx feed for Maine, New Hampshire, and Vermont | 5 min |
| Traffic incidents | New England 511 (Maine, New Hampshire, Vermont), CTroads, and MassDOT Highway Division roadway events (crashes, disabled vehicles, weather closures) | 60 s |
| Public traffic cameras | New England 511, CTroads, and the MassDOT CCTV asset inventory | 5 min |
| Live congestion speeds | Public 511 traffic-flow tiles through the gateway; TomTom remains an optional configured fallback | live tiles |
| Weather alerts | [NWS active alerts](https://api.weather.gov/) for the six states, drawn as severity-colored forecast-zone polygons; Extreme/Severe alerts also join the service-alert panel | 120 s (60 s edge cache) |
| Airport delays | [FAA NAS airport status](https://nasstatus.faa.gov/) ground stops, ground-delay programs, arrival/departure delays, and closures, drawn as rings on the FAA airport markers | 120 s (60 s edge cache) |
| Major roads and freight rail | U.S. Census TIGERweb primary roads and the FRA North American Rail Network | built snapshot |
| Canada border crossings | 38 road, rail, ferry, and remote-traveller facilities from the [CBSA Directory of Offices](https://www.cbsa-asfc.gc.ca/do-rb/menu-eng.html) | built snapshot |
| Marked walking and cycling routes | OpenStreetMap route relations via Waymarked Trails | live map tiles |
| Heritage and scenic railroads | 17 hand-curated operator routes (`scripts/heritage-railroads.json`), snapped to the FRA rail network where the tourist line runs on mapped track | built snapshot |
| Park-and-ride lots | MassDOT GeoDOT, CTDOT, VTrans, and MaineDOT ArcGIS services plus the NHDOT inventory republished by SWRPC | built snapshot |
| Public EV charging | [NREL/NLR Alternative Fuel Stations API](https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/) DC fast and Level 2 stations across all six states | built snapshot |
| Drawbridges and movable bridges | 25 hand-curated bridges with opening rules from [33 CFR 117 Subpart B](https://www.law.cornell.edu/cfr/text/33/part-117/subpart-B) | built snapshot |

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

The checked-in route snapshot contains more than 1,200 bus, commuter-rail,
Amtrak, ferry, passenger-boat, and air-service route features plus more than
38,000 scheduled bus stops, ferry landings, T stops, and rail stations,
assembled from 104 GTFS sources and 81 official-service corridors. Scheduled
routes remain visible when an operator publishes no live positions. Every view
except the MBTA core, Greater Boston, the North Shore, statewide Massachusetts
and All New England starts with the scheduled bus layer on,
and the sidebar reports scheduled route counts separately from live vehicles,
so a missing realtime credential no longer makes service look absent.
Rail and T stops are visible first, named ferry landings appear at harbor
zoom, and tiny collision-aware bus-stop labels appear only at close street
zoom. Every stop opens a source-attributed popup with its routes and published
accessibility information.

### Regions

Every region lives in one file, `scripts/regions-config.json`;
`scripts/build-regions.py` turns it into `public/data/regions.geojson`, and the
picker, the permalink, the route tags and the default layers all read from
there. The picker groups regions by state:

- **Boston area:** *Greater Boston (inside I-495)*, the default for first-time
  visitors: the 128 Massachusetts cities and towns with at least half their
  area inside the I-495 ring (closed along the coast). The builder recomputes
  the ring from `public/data/infrastructure.geojson` and fails if the town list
  drifts. *MBTA core* (key `boston`, formerly labelled Greater Boston):
  Boston, Cambridge, Somerville, Brookline, Newton, Quincy, Braintree,
  Chelsea, Everett, Revere, Malden, Medford, Arlington, Belmont, Watertown,
  Milton, and Winthrop.
- **Massachusetts:** Merrimack Valley (LRTA and MeVa member communities,
  including Lowell and Lawrence, plus the Nashoba Valley towns of Ayer,
  Shirley and Ashby), North Shore (Revere to Newburyport, including Cape
  Ann), Worcester County, Pioneer Valley (Hampden, Hampshire, Franklin), the
  Berkshires, South Coast (Bristol County plus GATRA's Norfolk and Plymouth
  County communities: Bellingham, Plainville, Lakeville, Marion,
  Mattapoisett, Rochester and Wareham), Cape Cod & Islands. Every
  Massachusetts municipality is now in at least one named region.
- **Rhode Island:** Providence metro (Providence, Kent, Bristol), Newport &
  South County (Newport, Washington, including Block Island).
- **Connecticut** (2022 Census planning regions): Hartford (Capitol), New
  Haven & Shoreline, Fairfield County (Western CT and Greater Bridgeport),
  Eastern Connecticut, Waterbury & Northwest Hills (Naugatuck Valley and
  Northwest Hills). All nine planning regions are covered.
- **New Hampshire:** NH Seacoast, Manchester, Nashua & Concord, Lakes & White
  Mountains, Monadnock Region (Cheshire County, Keene). With the Upper Valley
  below, all ten counties are covered.
- **Vermont:** Burlington & Champlain Valley, Southern Vermont, Montpelier &
  Central Vermont (Washington, Lamoille), Northeast Kingdom (Caledonia,
  Orleans, Essex). With the Upper Valley below, all fourteen counties are
  covered.
- **Maine:** Portland & Southern Maine, Midcoast Maine, Downeast & Acadia,
  Central & Western Maine, Bangor & the North.
- **New England:** All New England and the Upper Valley (Windsor and Orange,
  VT; Grafton and Sullivan, NH).

Old links still open where they did: `?region=boston`, a saved MBTA core
selection, and a shared hash with a camera but no `r=` all open the MBTA core.
Sub-regions ask the gateway for their parent state (the Upper Valley asks for
`new-england`) and clip the results in the browser, so the gateway still only
knows the eight IDs listed under [Gateway API](#gateway-api).

### Presets and scenes

Above the layer list, **Default**, **Routes** and **Clear** work as before.
The **Show** row switches on one kind of vehicle (Rail, Buses, Water, Air,
Roads, Bikes, or All live). The **Scenes** row sets a region and its layers in
one tap: Boston commute, Harbor watch, Islands by sea & air, Road trip, and
Maine islands. Presets live in `src/model/presets.js` as plain data; the
active preset stays highlighted until you change a layer by hand, and presets
whose layers all need the gateway are disabled rather than clearing the map.

**Basemap**, under Geography, switches between Dark (CARTO Dark Matter), Dark
without labels, and Satellite (Esri World Imagery with Esri place labels). The
choice is remembered, and `?basemap=satellite` opens it directly.
Metro-North's New Haven, New Canaan, Danbury, and Waterbury lines are included
in Connecticut; connected routes are allowed to continue outside the selected
boundary so riders can see the full trip into New York City.
CTDOT's Shore Line East (New London–Old Saybrook–New Haven, with its Bridgeport
and Stamford through trips) comes from the Shore Line East agency inside
Amtrak's official GTFS. That agency publishes no track shapes, so its ribbon
follows the matching slices of Amtrak's published Northeast Corridor shapes
between Shore Line East stations and is labeled approximate. South Portland
Bus Service merged into Greater Portland METRO in December 2024; its routes 21,
24A, and 24B now come from METRO's feed, and the retired South Portland static
feed (last service 2025-10-05) is no longer built. The Current (Bellows Falls /
Brattleboro) ended service in 2022 and its area is covered by MOOver!, so it
is no longer listed.

Concord Coach's seven intercity routes use a community-maintained GTFS feed
cataloged and continuously validated by Transitland. Greyhound and FlixBus use
their current official U.S. GTFS feed; the build keeps only trip patterns that
actually touch a New England state. Peter Pan Bus Lines uses the same
New England-only trip filter on its Trillium-published GTFS, which keeps 34 of
its 51 route patterns (Boston, Cape Cod, Providence, Worcester, Springfield,
Hartford, the Berkshires, and their New York/Newark connections). That file is
the carrier's last published schedule (feed version June 2024, nominal end
date 2024-12-31), so Peter Pan ribbons are labeled scheduled corridors rather
than a current timetable. Dartmouth Coach does not publish a
discoverable GTFS feed, so its Upper Valley–Boston/Logan and Upper Valley–NYC
corridors follow the stop order on the carrier's official schedules and link
back to those schedules from the map popup. These intercity carriers are shown
as schedules, not invented live vehicle positions.

Small-system and campus coverage (September 2026 additions): Northeastern
Connecticut Transit District (5 routes) and Northwestern Connecticut Transit
District (6 routes) now publish static GTFS and draw as scheduled ribbons
instead of directory markers, as do Sullivan County Transportation in New
Hampshire (8 routes), Waldo Community Action Partners' Rockland and Belfast
DASH loops in Maine (2 routes), and Yankee Trails' Albany–Bennington line (1
route, kept only where it touches Vermont). University shuttles are drawn in the bus group and tagged
`serviceClass: "campus"`: Harvard (3 drawn routes), MIT (7), Tufts (7), Boston
University (5), Boston College (13), UMass Boston (1), Brown (4), the
University of Rhode Island (3), Eastern Connecticut State University (3),
Quinnipiac (2), the University of Hartford (2), the University of New Haven
(4), Providence College (1), and Roger Williams University (6);
special-event, charter, and out-of-service patterns are filtered out. The
same tag covers the Longwood Collective's medical-area shuttles (14 routes)
and Mass General Brigham's hospital shuttles (24 routes, some of them marked
employees-only in their own route names) and the UConn Health campus shuttles
in Farmington (5 routes). EZRide, the Charles River TMA's public Cambridge
shuttle (3 routes), and Stamford's free Harbor Point Trolley (4 routes) are
drawn as ordinary buses. Nantucket WAVE is read from its own TransLoc GTFS
export rather than a catalog mirror, so its route ids match its live feed. Tri-County
Transit's North Country GTFS is reachable but its calendar ended on
2026-06-30, so its two flex routes stay directory markers until it is
re-published. In Aroostook County, ARTS's Saturday Star City Connector loop in
Presque Isle (2 route patterns) is drawn from the agency's Passio GTFS; the
rest of ARTS stays a demand-response marker. Cyr Bus Line's daily
Bangor–Caribou coach publishes no GTFS, so it follows the stop order on the
carrier's official schedule as a road-routed corridor, like Dartmouth Coach.
Winnipesaukee Transit System (Laconia, Gilford, Tilton, Franklin) publishes no
GTFS either and is listed as a directory marker.

C&J Bus Lines publishes only a two-trip GTFS stub, so its network is drawn from
the carrier's official timetables instead: Dover, Portsmouth, and Seabrook to
Boston South Station (about every two hours), to Logan Airport (every 30
minutes for most of the day), and non-stop to New York's Port Authority Bus
Terminal (two or three trips a day). The six C&J stops carry their street
addresses. Hand-built bus corridors can now list named stops in a `stops`
property and set `roadRouteEveryLeg` so that legs shorter than the usual 20 km
repair threshold also follow roads. The New York line reuses the map's
reviewed Boston–New York coach corridor, so it is drawn through Boston; C&J's
non-stop coaches may bypass downtown, and the popup says so. Go Buses' daily
Alewife–Riverside–New York coach (operated by Academy Bus) is drawn the same way
from the stops on the operator's site, with its own reviewed bus-safe controls
for the Riverside–Port Authority leg; it ends at Port Authority Gate 1, where it
moved on September 1, 2026.

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
the configured provider. Every ferry line is drawn from
`scripts/ferry-water-cache.json`, an audited geometry cache built from, in
order of preference, the operator's GTFS shape, an OpenStreetMap
`route=ferry` way matched to both published landings, or hand-drawn controls.
Any stretch that crosses land is rerouted on a water grid and then simplified
and smoothed only where the result stays in water. The audit
(`osm-land-v3`) measures each line against OpenStreetMap coastline land
polygons minus OSM lakes, riverbanks, and docks: no interior dry run may exceed
25 metres, no dry run within 300 metres of a landing may exceed 150 metres
(landings sit on piers), no path may cross itself, and every path must be
longer than 0.15 km and at least 0.95 times its terminal-to-terminal distance.
The geometry check (`npm run check`) verifies every ferry feature against its
cache entry, so a feed update or manual edit cannot silently restore an
over-land line; `scripts/ferry-water-report.md` lists each route's source and
before/after dry metres.
The active MBTA `Boat-Lynn` feed supplies Lynn–Boston service directly, while
the seasonal Salem–Boston Long Wharf service is retained as an explicit
official-schedule corridor so it remains visible without live vessel data.

Bluebikes is a Greater Boston system rather than a statewide brand. Its public
feed covers Arlington, Boston, Brookline, Cambridge, Chelsea, Everett, Malden,
Medford, Newton, Revere, Salem, Somerville, and Watertown. The same regional
layer also includes the separately operated Hartford, New Haven, and Providence
systems. No discoverable public GBFS system is currently cataloged for Vermont,
New Hampshire, or Maine, so the map does not fabricate stations there.

The **Other bike-share systems** layer (`data/bikeshare-systems.geojson`,
switched off by default, in the Shared & active travel section) marks the
systems that exist but publish no usable feed, one labeled marker per member
town: ValleyBike Share's nine Pioneer Valley municipalities plus UMass,
Rideable Nashua, Portland Bike Share, Newburyport's Port Bikeshare, Minuteman
Bikeshare (Acton, Concord, Lincoln, Maynard), CATMA's Bird e-bikes (Burlington,
South Burlington, Winooski), Metro Mobility's day-rental cities, the Community
Pedal Power e-bike library's three pickup points, Coast Provincetown, and Sandy
Pedals on Nantucket. CargoB's 15 cargo-bike home stations use the exact
coordinates from the operator's public station map. Town-center markers were
geocoded with Nominatim (OpenStreetMap, ODbL). Drop Mobility (ValleyBike,
Nashua) runs a GBFS server at `gbfs.dropmobility.com/systems/<id>/gbfs.json`,
but it answers `unauthorized/missing_key`, so those systems go live only once
the gateway holds a Drop key; Tandem Mobility's Movatic-app systems (Portland,
Newburyport, Minuteman) publish no feed URL at all.

The **Taxi & cab services** layer is a directory of who to call and where
cabs queue, because no New England taxi fleet publishes vehicle positions.
`scripts/taxi-services.json` holds 106 entries, each confirmed from an official
source: the Rhode Island Division of Public Utilities and Carriers' taxi list
by territory, the City of Boston's licensed-company list, town lists for
Nantucket and Stamford, New Hampshire's statewide provider directory, airport
ground-transportation pages, or the operator's own site. A company whose
garage address is not published sits on its city's center point and its popup
says so. OpenStreetMap adds 30 mapped taxi stands, cached in
`scripts/taxi-osm-cache.json` (refresh with
`build-reference-places.py --refresh-taxi-osm`). Ride-hail, limousine, and
medical-transport services are out of scope. Rebuild just this group with
`py -3 -X utf8 scripts\build-reference-places.py --taxi-only`.

The **Local & on-demand services** layer fills a different gap. It currently
catalogs 51 services that do not have reliable route geometry or public live
positions: Maine county transportation, New Hampshire community providers
(including the Winnipesaukee Transit System), Massachusetts microtransit, Connecticut's nine CTDOT
microtransit programs, RIPTA Flex zones, Vermont's regional demand-response
providers, and on-demand Boston Harbor and Maine coastal water taxis. These
are service-area reference points with links
to the official provider—not pretend bus paths.

Metro-North is different: the MTA's keyless realtime feed carries trip updates
for every train of the day and a GPS position only for trains that are
running. Motion shows a New Haven, New Canaan, Danbury, or Waterbury train at
its reported GPS fix and labels it **live**. A train with no fix from the last
five minutes is interpolated between its reported stations and labeled
“Estimated position from MTA trip updates.”

The gateway currently knows these live vehicle-position feeds:

- Massachusetts: MBTA, Pioneer Valley Transit Authority, Brockton Area
  Transit, Montachusett RTA, and Franklin RTA (the last three through Passio's
  public GTFS-realtime endpoints); WRTA and GATRA (public Cadavl
  GTFS-realtime producers); Lowell RTA (Cadavl); Lexpress; MIT, Tufts, and
  Harvard campus shuttles, EZRide, the Longwood Collective, and Mass General
  Brigham shuttles (all Passio); Nantucket WAVE and the Boston University,
  Boston College, and UMass Boston shuttles (TransLoc); Merrimack Valley
  Transit is a Swiftly feed that is not approved (see below)
- Connecticut: CTtransit, HARTransit, River Valley Transit (the merged
  Middletown Area Transit / 9 Town Transit district, via Passio), Norwalk
  Transit District, UConn / Windham Region Transit District, the Quinnipiac,
  University of Hartford, and University of New Haven shuttles, and
  Stamford's Harbor Point Trolley (all Passio); UConn Health and Eastern
  Connecticut State University shuttles (TransLoc)
- Rhode Island: RIPTA, Brown University and Providence College shuttles
  (Passio), and University of Rhode Island shuttles (TransLoc)
- Maine: Greater Portland METRO (including the former South Portland Bus
  Service routes), Island Explorer, Bangor Community Connector,
  Lewiston-Auburn citylink, and ARTS's Star City Connector (the last three
  via Passio); Casco Bay Lines ferries through Swiftly, drawn in the ferry
  layer
- New Hampshire/Vermont: COAST (Passio) and Advance Transit, plus Nashua
  Transit System and Vermont's GMT, GMCN, Marble Valley, MOOver!, RCT,
  and Tri-Valley feeds

TransLoc tenants publish keyless GTFS-realtime at
`https://<tenant>.transloc.com/subscriptions/gtfsrt/vehicles.ashx`, with route
ids that match the tenant's own GTFS export.

The legacy `boston` gateway region (the MBTA core) serves the shuttles that
run inside it: MIT, Tufts, Harvard, Boston University, Boston College, UMass
Boston, EZRide, Longwood, and Mass General Brigham.

The Swiftly-hosted providers (Merrimack Valley, Casco Bay Lines, Nashua,
Advance Transit, and the Vermont agencies) use Swiftly's authorized realtime
API. Swiftly issues one key but enables it agency by agency, and only for
agencies that pre-approve third-party sharing or approve in writing. Motion's
key covers Casco Bay Lines (and RIPTA, which is read from its own keyless feed
instead). The gateway therefore sends the key only to agencies listed in
`SWIFTLY_APPROVED_AGENCIES` in `worker/src/feeds.ts`; every other Swiftly feed
reports `needs-approval` and is never called, and all feeds report `needs-key`
until `SWIFTLY_API_KEY` is configured. Swiftly allows 180 requests per 15
minutes, so approved feeds are cached for 30 seconds and shared by every
region.
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
straight bus or Amtrak line. A feed that publishes no track shapes at all
(Sullivan County, Waldo DASH, Mashantucket, ARTS) is drawn stop-to-stop and
its popup says so: those ribbons carry `geometryAccuracy: "approximate"` with
a "Scheduled stop sequence" provider. A feed whose trips reference shape ids
that are missing from `shapes.txt` falls back to the same stop sequences
instead of disappearing.

Rebuild the static route snapshot after agencies update their schedules:

```powershell
py -3 -X utf8 scripts\build-regions.py
py -3 -X utf8 scripts\build-regional-routes.py
py -3 -X utf8 scripts\build-airports.py
py -3 -X utf8 scripts\build-border-crossings.py
py -3 -X utf8 scripts\build-reference-places.py
```

Build regions first: the route and reference builders tag every feature with
each region it touches. After only the regions change,
`py -3 -X utf8 scripts\build-reference-places.py --retag-only` retags the
reference places offline.

Normal rebuilds read ferry geometry from `scripts/ferry-water-cache.json` and
need no water data. When a ferry feed, catalog entry, or
`scripts/ferry-geometry-sources.json` changes (or a new ferry is added), fetch
the OpenStreetMap water model once and refresh the cache. The fetch downloads
the ~925 MB [osmdata.openstreetmap.de](https://osmdata.openstreetmap.de/)
land-polygon file once, keeps only New England
(west -74.2, south 40.7, east -65.8, north 47.8) in a compact
`.codex-research/water-audit/osm-land-ne.wkb.json`, and caches Overpass inland
water (`natural=water`, `waterway=riverbank`, `waterway=dock`) where ferry
corridors cross coastline land, plus all OSM `route=ferry` ways:

```powershell
py -3 -X utf8 scripts\fetch-ferry-audit-data.py
py -3 -X utf8 scripts\build-regional-routes.py --update-ferry-cache
py -3 -X utf8 scripts\audit-ferry-water.py --cache
py -3 -X utf8 scripts\audit-ferry-water.py --report --before <old regional-routes.geojson>
```

`--update-ferry-cache` recomputes only routes whose inputs changed (a full
`--refresh-ferry-cache` takes a few minutes); it needs `shapely`, `scipy`, and
`pyshp`. A ferry without a cache entry is still drawn from its raw source, but
the geometry check fails with instructions to run the command above.

Normal rebuilds make no road-router requests: that portion uses the checked-in
cache. The builder still downloads each agency's current GTFS schedule, so the
route snapshot can change when a provider updates its feed. A maintainer can
explicitly fetch generic road geometry for newly discovered long gaps (at a
rate limited to the public router's usage guidance), then review and commit the
updated cache:

```powershell
py -3 -X utf8 scripts\build-regional-routes.py --update-road-cache
```

Every route build also records the last date each GTFS feed publishes service
for (the latest `calendar.txt` end date or added `calendar_dates.txt` date,
falling back to `feed_info.txt` only when a feed has no calendar; `YYYYMMDD`,
`M/D/YYYY`, and ISO dates are accepted) in `scripts/feed-freshness.json`. To
refresh only that file, without rebuilding geometry, run:

```powershell
py -3 -X utf8 scripts\check-feed-freshness.py
```

It exits non-zero and names the feed when a schedule ends within seven days.
A feed with no current replacement can carry `"freshness_exempt": "<reason>"`
in `scripts/regional-feeds.json` (currently Peter Pan's 2024 GTFS, VTA's
summer feed, and the seasonal Island Explorer, Boston Harbor Islands, Block
Island Ferry, Vineyard Fast Ferry, Freedom Cruise Line, and Thompson Island
feeds whose published seasons end in mid-October 2026; each exemption names
the date and should be removed when the next season's feed appears). A feed
can also carry `"expired_note"`, appended to every route popup, when its last
published schedule is known to be stale (VTA's summer 2026 feed). Feeds whose
server rejects scripted downloads can set a per-feed `"user_agent"`.

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

The **Movement infrastructure** section also carries four reference-place
layers built by `scripts/build-reference-places.py` into
`public/data/reference-places.geojson`. Heritage and scenic railroads are a
hand-curated list of operators confirmed running in 2026 (Conway Scenic, the
Cog, Hobo/Winnipesaukee, Essex, Naugatuck, Cape Cod Central, Berkshire Scenic,
Vermont Rail System's Champlain Valley Dinner Train, Maine Narrow Gauge,
Belfast & Moosehead Lake, Downeast Scenic, WW&F, Seashore Trolley, Shelburne
Falls Trolley, and the Lowell NHP trolley); ten follow the FRA rail network and
the two-foot, cog, and streetcar lines are drawn as labeled approximate paths.
Park-and-ride lots come from each state DOT's ArcGIS service (Rhode Island
publishes none; New Hampshire's is a 2013 inventory and its popup says so).
Public EV charging keeps only stations with DC fast or Level 2 ports and is
hidden below zoom 10 because it is dense. Drawbridges are the major movable
bridges whose opening rules are published in 33 CFR 117, each popup linking the
governing section. All four start switched off, are clipped to the selected
region, and are reference points rather than live status.

## Find things and share views

The **Find** box at the top of the console searches everything already loaded
on the page — 38,000+ stops, stations, and ferry landings, every scheduled
route ribbon, every geography, and municipalities that appear in stop
names — with no external geocoder. Arrow keys, Enter, and Esc work as in any
combobox. Picking a stop flies to it and opens its popup; picking a route
highlights the ribbon and fits it in view; picking a geography switches the
region. A result outside the selected geography switches to the smallest region
that contains it, so its live vehicles are not clipped away. Towns that exist in
more than one state are listed with their state (Salem, MA and Salem, NH). MBTA stop popups add a **live** "Next arrivals" block from the
[MBTA V3 predictions](https://www.mbta.com/developers/v3-api) endpoint (up to
three per route, refreshed every 15 seconds while the popup is open); other
operators publish schedules only, and their popups say so instead of
inventing an ETA. The URL hash keeps the region, camera, any layer switched
away from its default, and the data-truth filter
(`#r=ct&c=-72.68,41.76&z=12&on=bike&off=commuter&s=live,scheduled`), so
copying the address shares exactly the view on screen. `?region=` still works
and takes second place to the hash.

## Follow a vehicle

Click any moving vehicle to select it: a ring marks it and a trip card opens
(top right on desktop, a bottom sheet on phones). Press **Follow** and the map
locks onto it. The followed vehicle glides across about 90% of its feed's poll
interval at constant speed, so the camera pans continuously instead of jumping
every 10 seconds; every other vehicle keeps the short snap. Dragging the map
releases the lock but keeps the card; zooming keeps the lock and remembers the
zoom; Esc or × closes it. Region changes, alert focus, layer zoom, and search
fly-tos also release the lock.

The **Find** box matches live vehicles too: commuter-rail, Amtrak, and
Metro-North train numbers (`5747`), MBTA car labels, regional bus vehicle
numbers, aircraft callsigns (`JBU` lists every JetBlue flight), and route
names (`red line`, `route 39`). Picking a vehicle locks onto it at once. An
empty box lists recently followed vehicles that are still reporting.

The card shows what each feed actually publishes:

| Fleet | Card detail |
|---|---|
| MBTA | Next six stops with ETA, clock time, track (commuter rail), and delay against the schedule, from `/predictions?filter[trip]=…`, polled every 15 s only while following |
| Amtrak | Upcoming stations with ETA and early/late, from the Amtraker train record |
| Metro-North | Next stop and minutes only; position is the train's GPS fix, or an estimate between stations when the feed has none |
| Aircraft | Best-effort scheduled route for the callsign |
| Regional buses, vessels | Route, vehicle number, speed |

A followed vehicle adds `f=<fleet>:<id>` to the URL hash, so **Copy link**
shares a view that opens locked onto that vehicle once its feed reports it
(or explains why after 30 to 120 seconds). If a vehicle drops out of its feed,
the card waits three poll intervals before giving up. The commuter-rail train
number is the tail of the MBTA trip id (`SouthBase-793096-5847`), checked on
every line on 2026-09-27; the car label MBTA puts on the vehicle is not the
number riders know.

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

#### Enable live vessels (AIS)

The vessel layer stays empty until the gateway has an AISStream key.

1. Create a free API key at [aisstream.io](https://aisstream.io) (sign in, then "API Keys").
2. Store it on the production Worker: `npx wrangler secret put AISSTREAM_API_KEY --env production`
3. Redeploy: `npx wrangler deploy --env production`
4. Open the gateway's `/health` and confirm it shows `"ais":true`.

How the vessel feed works:

- **One shared upstream.** AISStream allows only 3 connections per account,
  so the gateway does not open one per browser. A single `AisHub` Durable
  Object (`worker/src/ais-hub.ts`, SQLite-backed so it runs on the Free plan)
  holds one AISStream socket for the whole New England box and fans frames out
  to every viewer by region. Any number of viewers use 1 of the 3 slots.
- **Instant snapshot.** A new viewer first gets one `Snapshot` frame with every
  vessel the hub already knows in that region, stamped with the server time it
  was last heard, so the map fills in immediately and old positions dim.
- **Lifecycle.** The first viewer starts the upstream. A 60-second alarm
  reconnects it with backoff, prunes vessels not heard for 15 minutes, saves
  the snapshot as one storage row, and closes the upstream 5 minutes after the
  last viewer leaves. Deploys drop the upstream; the saved snapshot covers the
  gap while it reconnects. The Durable Object migration applies on the first
  `wrangler deploy` after this change.
- **Coastal filter.** Vessels are filtered against `public/data/regions-marine.geojson`
  (states and All New England grown 0.2 degrees, sub-regions 0.1 degrees, the MBTA core 0.06 degrees, and
  clipped to the AIS box) so ships just offshore are not cut off. Rebuild it
  with `py -3 scripts/build-regions.py --marine-only`.
- **Lakes gap.** Inland lakes such as Champlain and Winnipesaukee rarely show
  vessels: few boats there broadcast AIS and AISStream has little receiver
  coverage inland. The New York half of Lake Champlain only counts where it is
  within the coastal buffer of Vermont.

Deploy the separate aircraft relay from its own project directory:

```powershell
Set-Location aircraft-gateway
npx vercel link --yes --project motion-aircraft-gateway
npx vercel --prod --yes
```

## Gateway API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Provider status without exposing secrets; a provider reads `true` when its last upstream fetch succeeded within 10 minutes (or has not been attempted yet) |
| `GET /api/planes?region=ma` | Deduplicated, normalized ADS-B aircraft (Vercel relay only; the Worker no longer serves this path) |
| `GET /api/route?callsign=AAL108` | Best-effort aircraft origin and destination (Vercel relay) |
| `GET /api/transit?region=ct` | Normalized GTFS-realtime bus positions and per-feed health |
| `GET /api/mnr` | Metro-North active trip segments and service alerts from official MTA GTFS-Realtime |
| `GET /api/roadwork` | Active/upcoming MassDOT and northern New England WZDx geometry |
| `GET /api/road-events` | Official New England 511, CTroads, and MassDOT roadway-event incidents (planned MassDOT closures are left to `/api/roadwork`) |
| `GET /api/cameras` | Public camera locations from 511, CTroads, and MassDOT |
| `GET /api/camera-detail?provider=north&id=…` | Latest public 511 camera image and official viewer details |
| `GET /api/traffic/{z}/{x}/{y}.png` | Cached public 511 congestion tile, with optional TomTom source |
| `GET /api/airport-status` | FAA NAS status (ground stops, ground-delay programs, arrival/departure delays, closures) for New England airports |
| `GET /api/weather-alerts?region=ma` | NWS active alerts for the region's states as GeoJSON; forecast-zone polygons are resolved, simplified, and capped per request |
| `GET /api/ais?region=new-england` with WebSocket upgrade | Shared AISStream feed: a `Snapshot` frame of known vessels in the region, then live AISStream frames for that region |

Supported region IDs are `boston`, `ma`, `ct`, `ri`, `nh`, `vt`, `me`, and
`new-england`; the browser maps each named sub-region to its parent before
calling the gateway. Browser origins are allowlisted. Provider responses are cached
briefly at the edge to avoid multiplying load.

## Architecture

```text
Public browser-safe APIs ───────────────┐
  MBTA · static GTFS · Amtraker · GBFS │
                                       ├─ MapLibre fleets ─ Census region filter
Cloudflare Worker gateway ─────────────┤
  agency GTFS-RT · MTA MNR · 511 · WZDx · cameras · NWS · FAA · AIS│
Vercel aircraft relay ─────────────────┘
  ADSB.lol · adsb.fi · route lookup
```

The frontend is plain JavaScript bundled with Vite; Preact signal stores in
`src/stores/` feed a panel that `src/ui.js` still renders directly during the
component migration. The gateways are TypeScript and
run on Cloudflare Workers and Vercel Functions. Cloudflare gateway tests execute
inside the Workers runtime with Cloudflare's Vitest integration.

## Verify changes

```powershell
npm run check
npm test
npm run deploy:dry-run
```

CI (`.github/workflows/ci.yml`) first runs `scripts/check-feed-freshness.py`,
which downloads every schedule feed and fails when a non-exempt feed stops
publishing service within seven days. `npm run check` then applies the same
rule offline: every feed in `scripts/regional-feeds.json` must appear in
`scripts/feed-freshness.json`, and every non-exempt feed must publish service
at least seven days past that file's `checkedAt` date. When either fails, run
`scripts\check-feed-freshness.py`, replace the expired feed URL (or add a
documented `freshness_exempt`), and commit the refreshed `feed-freshness.json`.

## Remaining data gaps

- Many rural agencies publish schedules but no open live vehicle positions.
  A September 2026 survey of the remaining regional operators found: SRTA
  (Clever Devices BusTime) and UNH Wildcat Transit (Umo IQ) require a
  vendor API key; MWRTA and CCRTA expose only a proprietary JSON tracker;
  BRTA (RouteMatch), Manchester Transit (RouteShout), and VTA (Strategic
  Mapping) run closed trackers with alerts-only or no GTFS-realtime; CATA and
  Concord Coach have no public tracker at all. Those operators remain
  scheduled ribbons only. WRTA and GATRA turned out to publish public Cadavl
  GTFS-realtime (now live). LRTA, Bangor Community Connector, Lewiston-Auburn
  citylink, Lexpress, Harvard, Longwood, the University of New Haven,
  Providence College, Boston University, URI, and Eastern Connecticut State
  were added on Sunday 2026-10-04 with valid, fresh feeds
  that carried no vehicles because none of them was running. Passio's
  GTFS-realtime matched its rider app exactly for every system that did have
  buses out that day, so these are expected to populate on weekdays; confirm
  with `/api/transit?region=ma` and `?region=me` on a weekday.
- Swiftly-hosted agencies other than Casco Bay Lines (Merrimack Valley,
  Nashua, Advance Transit, Green Mountain Transit, GMCN, Marble Valley,
  MOOver!, RCT, Tri-Valley, Vermont Translines, South Portland) need each
  agency's written approval before Swiftly will enable the key for them.
- An October 2026 tracker survey found public rider maps with no open feed
  for Greater Bridgeport Transit (Trapeze WebWatch), SEAT (Swiftly), Massport's
  Logan shuttles, the Dartmouth Campus Connector, and BSOOB Transit (Trillium
  maps), the 128 Business Council (TripShot), and C&J and Peter Pan (uTrack).
  Milford Transit, NECTD, NWCTD, CTrail's Hartford Line and Shore Line East,
  Plymouth & Brockton, and the smaller Maine and New Hampshire operators have
  no tracker. The only snowplow source found is VTrans's own app data file,
  which is empty outside winter.
- Scheduled services found missing in the same audit and not yet drawn,
  because none publishes GTFS and each needs a hand-built corridor: Downeast
  Transportation's
  year-round Hancock County routes, York County Community Action's Sanford
  routes, the 128 Business Council shuttles, Seastreak's New York–Martha's
  Vineyard–Nantucket ferry, the Bustins Island ferry, the AMC and Franconia
  Notch hiker shuttles, several Cape Air city pairs, and New England Airlines'
  Westerly–Block Island flights.
- Cyr Bus Line (Bangor–Caribou) and the Winnipesaukee Transit System publish
  no GTFS. Cyr is drawn as an official-schedule corridor and WTS is a
  directory marker; neither has live positions. ARTS's Passio GTFS-realtime
  answered on 2026-10-04 with no vehicles (its loop runs Saturdays only).
- Peter Pan's public GTFS has not been re-published since June 2024, so its
  corridors are shown as scheduled service relationships rather than a
  current timetable.
- Metro-North reports GPS only for trains that are running; a train without a
  recent fix is an estimate between realtime station predictions.
- Non-MBTA ferry operators generally publish schedules, not GTFS-realtime
  positions. AIS supplies actual vessel movement when a ship is broadcasting,
  and passenger-ship metadata is used to classify ferries when available.
- Work-zone geometry is currently strongest in Massachusetts, Maine, New
  Hampshire, and Vermont. The USDOT WZDx feed registry lists no Connecticut
  or Rhode Island feed (checked 2026-10-04), so Connecticut road disruptions
  still appear through the CTroads incident feed rather than a uniform WZDx
  layer.
- Rhode Island has no road-condition coverage at all: RIDOT shares incident
  and closure data only with Waze, publishes no public camera or incident
  API, and its ArcGIS hosts were unreachable when checked. RIDOT also
  publishes no park-and-ride dataset, so the park-and-ride layer is empty
  there.
- Rhode Island publishes no coordinate-bearing incident or road-event feed:
  RIDOT's traveler page (dot.ri.gov/travel) is text only, so Rhode Island has
  no incident markers.
- Current GBFS coverage is Bluebikes' 13 Greater Boston municipalities plus
  Hartford, New Haven, and Providence. Other systems can be added as soon as
  they publish discoverable public feeds; until then they appear as reference
  markers in the Other bike-share systems layer, not as live stations.
- Public truck, delivery, and company-fleet positions are generally private
  telematics, and there is no national public live freight-train position feed.
  Motion maps the public FRA rail network instead of claiming scheduled or
  live freight locations it cannot verify.
- Flock/ALPR camera locations and live emergency-responder positions are not
  collected. Motion uses official public traffic cameras and public 511
  incidents without turning the map into a surveillance or responder-tracking
  tool.

Built by Max Howe — [github.com/mapzimus](https://github.com/mapzimus)
