// Central knobs for the whole app. Everything tunable lives here.

const params = new URLSearchParams(window.location.search);
const DEFAULT_GATEWAY_BASE = 'https://motion-gateway.mapzimus.workers.dev';
const DEFAULT_AIRCRAFT_GATEWAY_BASE = 'https://motion-aircraft-gateway.vercel.app';
const explicitGatewayBase = params.get('gateway');
const gatewayBase = (
  explicitGatewayBase || localStorage.getItem('motion-gateway') || DEFAULT_GATEWAY_BASE
).replace(/\/+$/, '');
const aircraftGatewayBase = (
  params.get('aircraft_gateway') ||
  localStorage.getItem('motion-aircraft-gateway') ||
  DEFAULT_AIRCRAFT_GATEWAY_BASE
).replace(/\/+$/, '');

const dataBase = `${import.meta.env?.BASE_URL ?? './'}data/`;

export const CONFIG = {
  API_BASE: 'https://api-v3.mbta.com',

  // MBTA API key (rate limit 1000 req/min vs 20 anonymous). Static sites ship
  // their keys in client JS by nature — this key is rate-limit-only, no
  // billing, and can be regenerated anytime at https://api-v3.mbta.com.
  // Override per-visit with ?api_key=YOUR_KEY.
  API_KEY: params.get('api_key') || 'd9bab356c0644656a933fd24f356b45f',

  // Worker gateway for feeds that cannot safely or reliably run in a browser.
  // Production uses the deployed Worker. Override once for local development
  // with ?gateway=http://localhost:8787; the override persists.
  GATEWAY_BASE: gatewayBase,
  AIRCRAFT_GATEWAY_BASE: aircraftGatewayBase,

  // Polling cadence per feed.
  VEHICLE_POLL_MS: 10_000, // one request covers the entire MBTA fleet
  ALERT_POLL_MS: 60_000,
  AMTRAK_POLL_MS: 90_000, // Amtraker returns every US train (~1 MB) — be kind
  PLANE_POLL_MS: 45_000,
  MNR_POLL_MS: 30_000,
  COACH_POLL_MS: 30_000,
  // The public tracker often sits still for a few minutes. Dim after 10,
  // and the gateway drops a fix after 20.
  COACH_STALE_AFTER_MS: 10 * 60 * 1000,

  // How long markers glide between polled positions.
  ANIMATE_MS: 900,
  // Follow mode. A followed vehicle glides across ~90% of its feed's poll
  // interval at constant speed so the locked camera pans continuously instead
  // of lurching once per poll. Everything else keeps the 900 ms snap.
  FOLLOW_POLL_MS: {
    mbta: 10_000, regional: 20_000, coaches: 30_000, mnr: 30_000, plane: 45_000,
    amtrak: 90_000, vessel: 2_500, bike: 60_000,
  },
  FOLLOW_GLIDE_FACTOR: 0.9,
  FOLLOW_MIN_ZOOM: { plane: 10, vessel: 13, ferry: 13, amtrak: 12, commuter: 13, bus: 15, default: 14.5 },
  FOLLOW_LOST_GRACE_POLLS: 3, // wait this many poll intervals before giving up
  FOLLOW_LOST_MAX_MS: 180_000,
  FOLLOW_RESTORE_MIN_MS: 30_000,
  FOLLOW_RESTORE_MAX_MS: 120_000,
  TRIP_PREDICTION_POLL_MS: 15_000,

  // A vehicle whose last report is older than this renders dimmed.
  STALE_AFTER_MS: 90_000,

  // Alert severity (MBTA scale 0-10) thresholds for the line badges.
  // >= major -> red badge, >= minor -> amber badge, below -> listed quietly.
  // MBTA's own scale: 1-2 informational (elevators, notices), 3-4 minor
  // delays, 5-6 detours and moderate delays, 7+ suspensions, shuttles, and
  // station closures. `minor: 5` keeps everyday bus-detour and small-delay
  // alerts out of the badge so amber still means "this changes your trip";
  // `major: 7` matches the MBTA's own "significant disruption" cut-off.
  ALERT_LEVELS: { major: 7, minor: 5 },

  MAP_CENTER: [-71.0589, 42.335],
  MAP_ZOOM: 11.5,
  // Navigation guardrail with enough margin for a wide screen to fit all six
  // states at once (a tight New England box forces MapLibre to over-zoom).
  MAP_BOUNDS: [[-80, 38], [-61, 50.5]],

  // The Silver Line is GTFS route_type 3 ("bus") but belongs with rapid
  // transit — these six route IDs get their own layer group.
  SILVER_ROUTES: ['741', '742', '743', '746', '749', '751'],

  // Route ribbons are drawn for every MBTA route — including all ~150 bus
  // routes (thin + faint, toggling with the bus layer). Geometry is static,
  // so it's cached as encoded polylines (compact enough for localStorage).
  SHAPE_CACHE_KEY: 'bim-shapes-v4',
  SHAPE_CACHE_TTL_MS: 24 * 3600 * 1000,
  REGIONAL_ROUTE_URL: `${dataBase}regional-routes.geojson`,
  INFRASTRUCTURE_URL: `${dataBase}infrastructure.geojson`,
  LOCAL_SERVICES_URL: `${dataBase}local-services.geojson`,
  // Bike-share systems without a usable public GBFS feed, one reference
  // marker per member town (or per home station where the operator publishes
  // exact hubs). Systems with feeds render live through SHARED_MOBILITY_SYSTEMS.
  BIKESHARE_SYSTEMS_URL: `${dataBase}bikeshare-systems.geojson`,
  BIKESHARE_REF_COLOR: '#c084fc',
  AIRPORTS_URL: `${dataBase}airports.geojson`,
  BORDER_CROSSINGS_URL: `${dataBase}border-crossings.geojson`,
  REFERENCE_PLACES_URL: `${dataBase}reference-places.geojson`,
  MNR_STOPS_URL: `${dataBase}mnr-stops.json`,
  MNR_COLOR: '#ee0034',
  MNR_STALE_MS: 2 * 60_000,

  // Amtrak via the community Amtraker API (CORS-open, no key). Exact region
  // clipping is handled by the shared Census boundary filter.
  AMTRAK_URL: 'https://api-v3.amtraker.com/v3/trains',
  AMTRAK_BBOX: { latMin: 40.7, latMax: 47.75, lonMin: -74.1, lonMax: -65.8 },
  AMTRAK_COLOR: '#5b9bd5',
  AMTRAK_STALE_MS: 5 * 60_000,

  // Aircraft are fetched server-side from ADSB.lol. The selected geography
  // controls overlapping probes, then the coastal (marine) region polygons
  // clip the results so planes over the harbor and sounds stay visible.
  PLANE_COLOR: '#9be1ff',
  AIRCRAFT_EMERGENCY_COLOR: '#ff5c5c', // ring under a 7500/7600/7700 squawk

  // AIS passes through the gateway so a provider key never enters the public
  // bundle. Traffic is relayed from the public 511 tile service and needs no
  // commercial API key.
  AIS_STALE_MS: 3 * 60_000, // dim vessels silent for 3 min
  // Drop a vessel after this much listening time without a report (the live
  // socket, plus the gateway's listening time for snapshot vessels). Moored
  // boats (SOG under AIS_MOORED_SOG_KN) are received only now and then.
  AIS_PRUNE_MOVING_MS: 15 * 60_000,
  AIS_PRUNE_MOORED_MS: 60 * 60_000,
  AIS_MOORED_SOG_KN: 1,
  AIS_MAX_AGE_MS: 6 * 60 * 60_000, // never show a position older than 6 h
  VESSEL_COLOR: '#63d8c8',

  // Keyless GBFS systems currently cataloged in New England. Discovery feeds
  // choose their own station/free-vehicle endpoints, so provider URL changes
  // do not require an app release.
  SHARED_MOBILITY_SYSTEMS: [
    {
      id: 'bluebikes',
      name: 'Bluebikes · 13 Greater Boston municipalities',
      discoveryUrl: 'https://gbfs.bluebikes.com/gbfs/gbfs.json',
      color: '#4d9fec',
      stationOnly: true,
    },
    {
      id: 'veo-hartford',
      name: 'Veo · Hartford',
      discoveryUrl: 'https://cluster-prod.veoride.com/api/shares/name/hrt/gbfs',
      color: '#69d277',
    },
    {
      id: 'veo-new-haven',
      name: 'Veo · New Haven',
      discoveryUrl: 'https://cluster-prod.veoride.com/api/shares/name/nhv/gbfs',
      color: '#69d277',
    },
    {
      id: 'spin-providence',
      name: 'Spin · Providence',
      discoveryUrl: 'https://mds.bird.co/gbfs/v2/public/provider/spin/providence/gbfs.json',
      color: '#ff7f32',
    },
  ],
  BIKE_POLL_MS: 60_000,
  BIKE_COLOR: '#4d9fec', // stocked
  BIKE_LOW_COLOR: '#ffb454', // 1-2 bikes left
  BIKE_EMPTY_COLOR: '#5c6570', // empty (also renders dimmed)
  BIKE_FREE_COLOR: '#69d277',

  // MassDOT's public Connected Work Zone feed is relayed and reduced by the
  // Worker because the ~3 MB upstream file is not browser-CORS enabled.
  ROADWORK_POLL_MS: 5 * 60_000,
  ROADWORK_COLOR: '#ff8a4c',

  // One consistent non-MBTA mode palette. Official subway colors remain the
  // exception because those colors are navigational information themselves.
  COMMUTER_COLOR: '#a58add',
  BUS_COLOR: '#f2b84b',
  FERRY_COLOR: '#2eb7c5',
  // Gateway transit feeds whose vehicles are boats, not buses.
  FERRY_FEEDS: ['casco-bay'],
  CAMERA_COLOR: '#d2d7dd',
  ROAD_WEATHER_COLOR: '#7ec8e3',
  MESSAGE_SIGN_COLOR: '#f0c14a',
  PLOW_COLOR: '#d6e8ff',
  AERIALWAY_COLOR: '#c4b5fd',
  INCIDENT_COLOR: '#ff5c5c',
  ROAD_COLOR: '#8a949f',
  FREIGHT_COLOR: '#b98b72',
  WALK_COLOR: '#8bdc78',
  CYCLE_COLOR: '#45b7e8',
  LOCAL_COLOR: '#9fc36a',
  AIRPORT_COLOR: '#9be1ff',
  BORDER_COLOR: '#f0d27a',
  HERITAGE_RAIL_COLOR: '#e07a5f',
  PARK_RIDE_COLOR: '#7fb7ff',
  EV_CHARGING_COLOR: '#6ee7a8',
  DRAWBRIDGE_COLOR: '#f7c948',
  TAXI_COLOR: '#ffe14d',

  CAMERA_POLL_MS: 5 * 60_000,
  ROAD_WEATHER_POLL_MS: 5 * 60_000,
  MESSAGE_SIGN_POLL_MS: 5 * 60_000,
  PLOW_POLL_MS: 60_000,
  ROAD_EVENT_POLL_MS: 60_000,

  // Conditions: NWS active weather alerts (zone polygons) and FAA airport
  // ground stops / delays, both relayed by the Worker and edge-cached 60 s.
  WEATHER_POLL_MS: 120_000,
  AIRPORT_STATUS_POLL_MS: 120_000,
  WEATHER_COLORS: { extreme: '#ff5c5c', severe: '#ff5c5c', moderate: '#ffb454', minor: '#9aa3ad' },
  AIRPORT_STATUS_COLORS: {
    'ground-stop': '#ff5c5c',
    closure: '#ff5c5c',
    'ground-delay': '#ff8a4c',
    'arrival-delay': '#ffb454',
    'departure-delay': '#ffb454',
  },
  // Only NWS alerts at these severities join the service-alert panel.
  WEATHER_PANEL_SEVERITIES: ['Extreme', 'Severe'],

  // Aviation conditions: AviationWeather.gov METAR flight categories and FAA
  // TFR polygons (both relayed by the Worker, edge-cached 5 min), plus FAA
  // airspace as a static reference file loaded only when switched on.
  AIRPORT_WEATHER_POLL_MS: 5 * 60_000,
  TFR_POLL_MS: 5 * 60_000,
  // The aviation-standard category colors: VFR green, MVFR blue, IFR red, LIFR magenta.
  FLIGHT_CATEGORY_COLORS: { VFR: '#3ccf6a', MVFR: '#4f8dff', IFR: '#ff4d4d', LIFR: '#e04fe0', unknown: '#8a949f' },
  TFR_COLORS: { VIP: '#ff4d4d', SECURITY: '#ff4d4d', SPECIAL: '#ff4d4d', HAZARDS: '#ff8a4c', default: '#ffc94d' },
  AIRSPACE_COLORS: { B: '#4f8dff', C: '#d65cd6', D: '#4f8dff', sua: '#ff9a3c' },
  AIRSPACE_URL: `${dataBase}airspace.geojson`,
  PLOW_ROUTES_URL: `${dataBase}plow-routes.geojson`,
  AERIALWAYS_URL: `${dataBase}aerialways.geojson`,

  TRAFFIC_TILE_TEMPLATE: gatewayBase
    ? `${gatewayBase}/api/traffic/{z}/{x}/{y}.png`
    : '',
  WALK_TILE_TEMPLATE: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
  CYCLE_TILE_TEMPLATE: 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png',

  // Layer groups that start switched off (dense layers — one tap turns them
  // on: ~400 buses, ~600 bike stations, wall-to-wall traffic color).
  DEFAULT_OFF_GROUPS: [
    'bus', 'bike', 'roadwork', 'traffic', 'incident', 'camera',
    'road-weather', 'message-sign', 'plow',
    'roads', 'freight', 'walking', 'cycling', 'local', 'airport', 'border', 'air-service',
    'bikeshare', 'heritage-rail', 'aerialway', 'park-ride', 'ev-charging', 'drawbridge', 'taxi',
    'weather', 'airport-status',
    'airport-weather', 'tfr', 'airspace',
  ],

  // First entry is the default. The panel stays dark on every basemap.
  // `ground` picks the casings and fills applied in setupLayers. Satellite's
  // style document is built at load (USGS imagery plus Dark Matter place names).
  BASEMAPS: [
    { key: 'dark', label: 'Dark', ground: 'dark', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
    { key: 'light', label: 'Light', ground: 'light', style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' },
    { key: 'dark-plain', label: 'Dark, no labels', ground: 'dark', style: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json' },
    { key: 'satellite', label: 'Satellite', ground: 'imagery' },
  ],
};

// Persist only the gateway address. Provider credentials are Worker secrets.
if (params.get('gateway')) {
  try {
    localStorage.setItem('motion-gateway', gatewayBase);
  } catch {
    /* private mode — session-only */
  }
}

if (params.get('aircraft_gateway')) {
  try {
    localStorage.setItem('motion-aircraft-gateway', aircraftGatewayBase);
  } catch {
    /* private mode — session-only */
  }
}
