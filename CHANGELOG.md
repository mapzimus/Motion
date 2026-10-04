# Changelog

## Unreleased

Closes the gaps found by the 2026-10-04 coverage audit.

### Regions
- Four new named regions: Waterbury & Northwest Hills (CT), Monadnock Region
  (NH), Montpelier & Central Vermont, and Northeast Kingdom (VT). Every county
  and Connecticut planning region is now inside a named region.
- Merrimack Valley gains Ayer, Shirley, and Ashby; South Coast becomes a
  27-town list that adds GATRA's Bellingham, Plainville, Lakeville, Marion,
  Mattapoisett, Rochester, and Wareham. No Massachusetts municipality is left
  to the statewide view only.
- `regions-marine.geojson` rebuilt; it had no North Shore outline.

### Transit coverage
- New schedule feeds: University of New Haven shuttles and ARTS's Star City
  Connector (Presque Isle).
- New live-bus feeds: LRTA (Cadavl), Lexpress, Harvard, Bangor Community
  Connector, University of New Haven, and ARTS (Passio).
- Cyr Bus Line's Bangor–Caribou coach drawn as a road-routed official-schedule
  corridor; Winnipesaukee Transit System added as a directory marker.
- Greater Portland METRO now reads the agency's Cadavl origin feed; the
  Mobility Database mirror had stopped at 2026-10-03.

### Geometry
- Feeds with no track shapes (Sullivan County, Waldo DASH, Mashantucket, ARTS)
  are labeled approximate with a "Scheduled stop sequence" provider instead of
  passing as exact ribbons.
- Trips whose shape ids are missing from `shapes.txt` fall back to their stop
  sequence instead of vanishing (ARTS ships an empty `shapes.txt`).

### Build and CI
- Builders write to `public/data/` again (they still pointed at the old
  `data/` folder after the Vite move, so nothing could be rebuilt).
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
