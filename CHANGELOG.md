# Changelog

## Unreleased

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
- Twelve more live feeds: Lowell RTA, Lexpress, Harvard, EZRide, Longwood
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
