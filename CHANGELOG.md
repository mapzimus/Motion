# Changelog

## Unreleased

### Roads and vessels
- RIDOT traffic cameras, with the still image URL on each point, and `ri` on the camera coverage list.
- RIDOT park-and-ride lots in the reference-places layer.
- CTroads closures join the existing Connecticut incident feed.
- CTDOT capital-project areas in phase `05_Construction` draw as construction projects beside the WZDx work-zone lines.
- When `AISSTREAM_API_KEY` is unset, the vessel relay uses keyless Open Waters AIS and keeps each source's required credit. AISStream is unchanged when the key is set. The browser stays on the gateway.

### Boats
- Far more boats on the map. The AIS hub now ages vessels by listening time:
  a boat is only dropped after 15 minutes of the upstream being open without
  hearing it (60 minutes if it was moored, under 1 knot), plus a 6-hour
  real-time cap. Quiet spells with no viewers no longer empty the snapshot, so
  a new visitor sees every boat the hub still knows instead of a blank harbor.
  The listening clock is saved with the snapshot and survives restarts.
- The hub keeps its AISStream connection 20 minutes after the last viewer
  leaves (was 5), so the next visitor usually gets a warm snapshot.
- The map uses the same rules: moving boats drop after 15 minutes unheard,
  moored boats after 60, and snapshot boats up to 6 hours old show dimmed
  instead of being discarded. Vessel popups and the trip card say "Last heard
  12 min ago" (hours when older) from the boat's real last report.
- Popup ages read "5 min ago" and "2 h 5 min ago" instead of "5m ago" and
  "125m ago".

### Aviation conditions
- **Airport weather (METAR)**: about 64 New England weather stations as dots
  colored by flight category (VFR green, MVFR blue, IFR red, LIFR magenta).
  The popup shows the category, wind, visibility, ceiling, how old the
  observation is, and the raw METAR, then loads the station's TAF. Served by
  the new gateway endpoints `/api/airport-weather` (5 min edge cache) and
  `/api/airport-taf?id=` (strict ICAO id check, 30 min cache) with the
  User-Agent AviationWeather.gov asks for.
- **Temporary flight restrictions (FAA)**: TFR polygons inside New England
  from the FAA TFR map service, joined to the FAA TFR list for type and
  facility (`/api/tfrs`, 5 min cache). Clicking one loads its altitudes,
  effective times, and reason from the FAA notice (`/api/tfr-detail?id=`,
  30 min cache) and links to it.
- **Airspace (Class B/C/D & special use)**: a static FAA reference layer,
  `public/data/airspace.geojson` (69 shapes, ~100 KB), built by the new
  `scripts/build-airspace.py` from the FAA ADDS services. It downloads only
  when switched on. Outlines follow the sectional chart (B blue, C magenta,
  D dashed blue, special use orange) with "ceiling/floor" labels; popups list
  every layer at the click, floor first, with a reminder to check current
  charts and NOTAMs. `npm run check` validates the file.
- All three rows sit under Air & water beside Airport delays, start switched off, and join the Air
  preset. `/health` reports `airportWeather` and `tfrs`.

### Aircraft and airports
- Live aircraft draw by type: airliner, light aircraft, helicopter, or a
  plain dart for gliders, balloons, drones and unknowns, from the ADS-B
  emitter category (or the ICAO type code when none is sent).
- An aircraft squawking 7500, 7600 or 7700, or reporting an emergency
  status, gets a red ring on the map and a line in its card, e.g.
  "Squawking 7700 · general emergency".
- Aircraft are clipped with the coastal boundary like vessels, so planes over
  Boston Harbor, Long Island Sound and the Cape waters no longer vanish.
- Cards show the registration and whether the aircraft is climbing or
  descending. Privacy: owner/operator names are never relayed, registrations
  are withheld for PIA and LADD aircraft, and helicopters show only their
  type. Nothing singles out military or LADD aircraft.
- Heliports and seaplane bases get their own marks; public-use airports are
  in Find by name or FAA/ICAO code (`BOS`, `KBOS`, `logan`).
- Seasonal air corridors now carry their season dates and turn into
  reference lines out of season. Tradewind's Bedford–Nantucket and
  Bedford–Martha's Vineyard flights (season ended September 8, 2026) now
  read that way; Cape Air Boston–Provincetown is year-round (reduced winter
  schedule); Norwood–Nantucket runs through October 13, 2026.
- The aircraft relay returns `category`, `squawk`, `emergency`,
  `registration`, `verticalRateFpm` and `dbFlags` (fields only added), and
  `/api/route` answers a clean 502 when the route catalog is down. **The
  relay is a separate Vercel project: redeploy it (`cd aircraft-gateway;
  npx vercel --prod`) for emergency rings, registrations and
  category-based icons to appear.** Until then icons come from the type code
  alone.
- Removed the unused plane popup route lookup; the trip card keeps it.

### Legend & colors
- A map key appears at the bottom right (on a phone, a "Key" pill that opens a
  sheet) listing what is switched on and who runs it, with live-vehicle and
  route counts.
- Buses, ferries, commuter rail, and air services are now colored by operator.
  Each operator's routes shade apart when you zoom in past about zoom 13.5,
  and live vehicles match their routes.
- Vessels are colored by their AIS ship type.
- The layer panel merged its two "Conditions" sections and renamed the bus,
  local, and commuter rail rows.

### Coaches
- C&J Bus Lines' full network replaces its two-trip GTFS stub: Dover,
  Portsmouth, and Seabrook to Boston South Station, Logan Airport, and New
  York's Port Authority, road-routed from the official timetables, with the
  six C&J stops and their addresses.
- Hand-built bus corridors can list named stops and road-route every leg.
- Go Buses' Alewife–Riverside–New York coach drawn as a road-routed corridor
  with its two Boston-area stops. All cached road segments were refetched
  because the routing controls changed; no existing route moved by more than 2%.

### Regions, presets & basemaps
- New **North Shore** region: 26 communities from Revere to Newburyport,
  Cape Ann included, with its own vessel boundary so the Salem ferry and boats
  off Cape Ann stay visible offshore. Blue Line rows show there and buses
  start switched on.
- **Basemap** picker: Dark, Dark without labels, and Satellite. The choice is
  remembered and `?basemap=` stays in sync with it.
- "All live" now includes the subway; "Boston commute" no longer hides route
  lines and stops; presets whose layers all need the gateway are disabled
  instead of clearing the map; the active preset is highlighted; applying a
  preset no longer stops the next region's bus default from applying.
- **Find** now follows its result: picking a town, stop, station, ferry landing
  or route outside the selected geography switches to the smallest region that
  contains it, instead of flying to an empty map. Same-named towns are listed
  by state (Salem, MA / Salem, NH; likewise Concord, Plymouth, Manchester,
  Berlin, Bristol, Newport, Windsor, Waterbury), where one used to hide the
  other. A stop pick no longer opens its popup early while the camera is still
  moving from the region switch.
- Park & ride, EV charging, heritage rail and drawbridge counts (and the
  "places" total) now update when their data finishes loading rather than at
  the next region change; the traffic, walking and cycling rows say "overlay"
  instead of a permanent dash.
- Region names and descriptions tidied: "Providence Metro", "New Hampshire
  Seacoast" and "Berkshires" now match the others' style, and descriptions
  that only repeated the name ("State of Maine", "Worcester County") say what
  the region covers.
- On phones, tapping a scene closes the panel like picking a region does,
  even when you are already in that scene's region; layer presets and basemap
  buttons leave it open for further tuning. Find and the map now share one
  camera-padding helper, measured from the panel itself, instead of two copies
  with a hard-coded width.
- Startup no longer waits on the route ribbons to fill in the panel. The panel
  now receives counts, connection status and alerts as soon as it is built, and
  the loading overlay lifts once the map and live feeds are running instead of
  after the last route shape arrives (ribbons fill in behind it). In a throttled
  test the overlay and "Live" status appeared 13 seconds before the ribbons.
  A failed startup request still shows the error overlay.
- Panel restyle: solid surface, IBM Plex Sans, sentence-case copy, a labeled
  Layers/Close button on phones.
- `scripts/build-regions.py` writes to `public/data/` again, and
  `npm run check` fails when any region lacks a marine boundary.

### Shared & active travel
- New **Other bike-share systems** reference layer: 50 labeled markers for
  New England bike-share and e-bike systems that publish no usable public
  GBFS feed — ValleyBike Share (nine Pioneer Valley towns plus UMass),
  Rideable Nashua, Portland Bike Share, Port Bikeshare (Newburyport),
  Minuteman Bikeshare, CATMA's Bird e-bikes, CargoB's 15 cargo-bike hubs,
  Metro Mobility, the Community Pedal Power e-bike library, Coast Provincetown,
  and Sandy Pedals. The Bikes preset switches it on with the live layer.
- A failed startup fetch now shows the error overlay instead of hanging on
  "Loading New England…".

### Live vehicles
- Metro-North trains on the New Haven, New Canaan, Danbury, and Waterbury lines
  now use the GPS position the MTA feed reports and are labeled live. Trains
  without a fresh fix keep the between-stations estimate.
- Twelve more live feeds: Lowell RTA, Lexpress, Harvard (since removed, see
  below), EZRide, Longwood
  Collective, Mass General Brigham, Quinnipiac, University of Hartford,
  University of New Haven, Providence College, Bangor Community Connector, and
  Lewiston-Auburn citylink.
- Seven TransLoc feeds: Nantucket WAVE, Boston University, Boston College,
  UMass Boston, URI, Eastern Connecticut State, and UConn Health. Stamford's
  Harbor Point Trolley is live too.
- The MBTA-core region now shows the campus and hospital shuttles that run
  inside it.
- The Swiftly key is sent only to agencies that approved sharing (Casco Bay
  Lines), and approved feeds are cached for 30 seconds. Previously a configured
  key was sent to every Swiftly feed and rejected by nine of them every poll.
- Harvard's live shuttle feed is removed. Harvard moved its tracking from
  Passio GO to Citymapper on 2026-07-01 and Citymapper publishes no open feed;
  the old Passio endpoint still answers but is permanently empty. Harvard's
  scheduled routes stay on the map. Roger Williams was checked too: its Passio
  system has no realtime endpoint, so it stays scheduled-only.

### Logan Express & Massport
- Massport's 16 announcement and timing points ("Welcome to Logan",
  "Announcement #1–#5", "Overflow Parking Lot (FH)", "RCC Ez Pass" and the
  like) are no longer drawn as bus stops: nobody can board or leave there.
  New opt-in feed rule `skip_non_boarding_stops`.
- Woburn is labelled "WO · Woburn" instead of "WO". A letter-code short name
  now hides the long name only when it appears there as a whole word, which
  also fixes RIPTA "R · Broad/North Main", Harvard "AL · Allston Loop", Brown
  "X · Daytime Express" and "E · Evening CW/CCW Route", Nashua "N · North
  Route" and "S · South Route", GATRA "LIB · Liberty Link", SRTA "WARE ·
  Wareham/New Bedford", and Western Maine "BLU · Blue Line".
- Each Logan Express route and its stops link to the route's Massport page
  (terminal-curb stops to the Logan Express overview); the airport shuttles
  link to Massport's On-Airport Shuttle page instead of the Mobility Database.
- "RF · Remote Framingham" is marked as the Remote Terminal pilot: Delta and
  JetBlue passengers only, reservation required, drops passengers inside
  security at Logan, through February 2027.
- The Logan Airport Remote Terminal (19 Flutie Pass, Framingham) is a new
  reference point in Local & on-demand services, with hours, airlines, how
  the TSA screening works, and the pilot's end date.

### Transit coverage
- Eight more schedule feeds: EZRide, Longwood Collective, Mass General Brigham,
  Quinnipiac, University of Hartford, University of New Haven, Providence
  College, and Roger Williams University.
- Harbor Point Trolley and UConn Health shuttles added. Nantucket WAVE now
  reads its own TransLoc export.
- Greater Portland METRO reads the agency's own GTFS; the catalog mirror had
  expired on 2026-10-03.

### Taxi and cab services
- New reference layer: 106 licensed cab companies, dispatch associations, and
  official taxi stands confirmed from licensing lists, airport pages, and
  operator sites, plus 30 OpenStreetMap taxi stands. Off by default, under
  Ground & rail.

### Build
- The Python builders write to `public/data/` again; they still pointed at the
  old `data/` folder after the Vite restructure and could not run.

### Regions (coverage audit, 2026-10-04)
- Four new named regions: Waterbury & Northwest Hills (CT), Monadnock Region
  (NH), Montpelier & Central Vermont, and Northeast Kingdom (VT). Every county
  and Connecticut planning region is now inside a named region.
- Merrimack Valley gains Ayer, Shirley, and Ashby; South Coast becomes a
  27-town list that adds GATRA's Bellingham, Plainville, Lakeville, Marion,
  Mattapoisett, Rochester, and Wareham. No Massachusetts municipality is left
  to the statewide view only.
- `regions-marine.geojson` rebuilt; it had no North Shore outline.

### Coverage audit follow-ups
- ARTS's Saturday Star City Connector loop in Presque Isle is drawn from the
  agency's Passio GTFS, with its live feed wired; the rest of ARTS stays a
  demand-response marker.
- Cyr Bus Line's Bangor–Caribou coach drawn as a road-routed official-schedule
  corridor; Winnipesaukee Transit System added as a directory marker.
- Feeds with no track shapes (Sullivan County, Waldo DASH, Mashantucket, ARTS)
  are labeled approximate with a "Scheduled stop sequence" provider instead of
  passing as exact ribbons.
- Trips whose shape ids are missing from `shapes.txt` fall back to their stop
  sequence instead of vanishing (ARTS ships an empty `shapes.txt`).
- CI runs `scripts/check-feed-freshness.py` before the offline guard.
- Seasonal feeds ending 2026-10-12/13 and VTA's ended summer feed carry dated
  `freshness_exempt` reasons; VTA popups note the stale schedule.

## 1.0.0 — 2026-09-27

The first complete release of New England in Motion.

### Road and sea traffic
- Massachusetts traffic incidents from the official MassDOT Highway Division
  roadway-events feed. Incidents now cover Connecticut, Massachusetts, Maine,
  New Hampshire, and Vermont.
- Live vessel (AIS) relay is covered by tests. It turns on once the
  `AISSTREAM_API_KEY` Worker secret is set; see "Enable live vessels (AIS)" in
  the README.
- Gateway secrets are typed on `Env` rather than cast.

### Ferries
- Every ferry line is now drawn from an OpenStreetMap shoreline-audited water
  cache (`scripts/ferry-water-cache.json`). CI rejects any ferry that crosses
  land, loops over itself, or is shorter than the distance between its landings.
- The six Steamship Authority routes (Woods Hole–Vineyard Haven, Woods
  Hole–Oak Bluffs, Hyannis–Nantucket) were zero-length and invisible; they now
  draw real water paths.
- About 20 routes that cut across land were corrected, including New
  Bedford–Martha's Vineyard, Boston–Provincetown, Cranberry Isles, Chebeague,
  the Rockland island ferries, and Isles of Shoals.
- Official GTFS adopted for Maine State Ferry Service, Isle au Haut, Lake
  Champlain Ferries, Seastreak, Patriot, Freedom Cruise Line, and Thompson
  Island; the hand-drawn duplicates were removed. Thimble Islands ferry added.

### Transit coverage
- New schedule feeds: NECTD, NWCTD, Sullivan County, Waldo CAP DASH, C&J,
  Yankee Trails (Bennington), and campus shuttles for Harvard, MIT, Tufts,
  Brown, BU, BC, URI, Eastern CT State, and UMass Boston.
- Shore Line East, extracted from Amtrak's official GTFS.
- New live-bus feeds: WRTA, GATRA, MIT, Tufts, Brown, and UConn.
- Fixed Greater Portland METRO live buses, which failed because its server
  rejected the gateway's request header.
- Nine expired schedule feeds replaced with current sources (GATRA, WRTA,
  LRTA, Nashua, citylink, Western Maine, Casco Bay, Lexpress, Steamship
  Authority). The retired South Portland and The Current feeds were removed.
- Seven Cape Air corridors added (18 air corridors in total).
- CI now fails when a schedule feed is about to expire
  (`scripts/feed-freshness.json`).

### Included from the gap-audit batch
- Weather alerts, FAA airport delays, MBTA stop predictions, search,
  permalinks, and reference layers (heritage rail, park-and-ride, EV charging,
  drawbridges). Peter Pan schedules and more realtime adapters.
