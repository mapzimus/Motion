# API keys and registrations

Everything Motion shows in New England and New York runs without a key. The
cities below mostly do too, but their flagship operators gate realtime behind
a free developer registration. Each row names the secret the gateway reads,
the sign-up page, and what lights up once it is set. Nothing breaks when a
key is missing: that feed just reports `needs-key` in `/api/transit` and the
schedule ribbons stay.

## How to add a secret

Cloudflare Worker (the gateway), per environment:

```powershell
npx wrangler secret put WMATA_API_KEY --env production
```

Local development reads the same names from `.dev.vars` (copy
`.dev.vars.example`). The aircraft relay on Vercel needs no keys.

## Keys by city

| Secret | Sign up | Unlocks | Notes |
|---|---|---|---|
| `WMATA_API_KEY` | https://developer.wmata.com/ (free "Default Tier" product, instant) | Washington: Metrorail and Metrobus live positions, rail and bus alerts | Sent as the `api_key` header. 10 calls/s, 50,000/day on the free tier; the gateway's 15 s edge cache keeps it far below that. |
| `CTA_TRAIN_API_KEY` | https://www.transitchicago.com/developers/traintrackerapply/ (form, emailed within a day) | Chicago: 'L' train positions on all eight lines | Train Tracker is JSON, not GTFS-realtime; the gateway adapts it. |
| `CTA_BUS_API_KEY` | https://www.transitchicago.com/developers/bustracker/ (form, emailed within a day) | Chicago: CTA bus positions (about 1,800 buses) | Bus Tracker returns at most 10 routes per call; the gateway batches the 127 routes. |
| `METRA_ACCESS_KEY` and `METRA_SECRET_KEY` | https://metra.com/developers (free account) | Chicago: Metra commuter rail positions | HTTP basic auth against `gtfsapi.metrarr.com`, which answers JSON rather than protobuf; the gateway adapts it. |
| `BAY_511_API_KEY` | https://511.org/open-data/token (instant) | Bay Area: Muni, BART, Caltrain, AC Transit, SamTrans, VTA, Golden Gate Transit and Ferry, San Francisco Bay Ferry and SMART, live | One key, one GTFS-realtime vehicle-positions call per operator (ten operators). The default allowance is 60 calls an hour per key, so the gateway caches each operator for 10 minutes (about 54 calls an hour). Ask 511 for a higher limit (they grant it by email) and lower `BAY511_CACHE_SECONDS` in `worker/src/index.ts` to 30 for live-looking motion. |
| `NJ_TRANSIT_USERNAME` and `NJ_TRANSIT_PASSWORD` | https://developer.njtransit.com/ (free account; approval takes a few days) | New Jersey: NJ Transit rail, light rail and bus live positions | The API issues a token that expires daily; the gateway refreshes it. |
| `NY_511_API_KEY` | https://511ny.org/developers/register (instant) | New York: road events, work zones, cameras, message signs and winter road conditions on the Roads layers | 511NY's REST API; same shapes as the New England 511 adapters. |
| `PA_511_API_KEY` | https://www.511pa.com/developers (free account) | Philadelphia: PennDOT incidents, construction and cameras | Needed only for the Roads layers in Pennsylvania. |

## Already documented keys (optional, New England)

| Secret | Sign up | Unlocks |
|---|---|---|
| `AISSTREAM_API_KEY` | https://aisstream.io/ | Vessel positions from AISStream instead of the keyless Open Waters relay |
| `SWIFTLY_API_KEY` | https://www.goswift.ly/ (agency approval per feed) | The Swiftly-hosted regional feeds that approved sharing |
| `TOMTOM_API_KEY` | https://developer.tomtom.com/ | Optional congestion tiles in place of the public 511 tiles |
| `CARTO_API_KEY` | https://carto.com/ | Optional basemap key |

## No key needed

Verified keyless on 2026-10-26: MTA New York (subway, LIRR, Metro-North, Bus
Time), NYC Ferry, NY Waterway, SEPTA bus and regional rail, MARC, VRE,
Fairfax Connector, Alexandria DASH (its OneBusAway feed), Emery Go-Round,
Pottstown PART, TCAT, and the Indego, Capital Bikeshare, Divvy and Bay Wheels
bike-share feeds. PATCO, Pace, Ride On, TheBus, OmniRide, County Connection,
WestCAT, NICE, Bee-Line, NFTA, RTS and Centro publish schedules but no open
vehicle positions; DC Circulator ended service in 2024.

## Where each city stands without keys

| City | Live today with no key | Needs a key above |
|---|---|---|
| Philadelphia | SEPTA bus, trolley and Regional Rail; Pottstown PART; Indego | NJ Transit buses into Philadelphia |
| Washington | MARC, VRE, Fairfax Connector, DASH; Capital Bikeshare | Metrorail and Metrobus (`WMATA_API_KEY`) |
| Chicago | Divvy only | CTA trains and buses (two CTA keys), Metra (two Metra values) |
| Bay Area | Emery Go-Round; Bay Wheels | Everything else (`BAY_511_API_KEY`) |

Pick a region in the map's region menu; the gateway serves each metro only
its own feeds (`/api/transit?region=chicago`), and `/health` lists which keys
are set.
