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

  // How long markers glide between polled positions.
  ANIMATE_MS: 900,

  // A vehicle whose last report is older than this renders dimmed.
  STALE_AFTER_MS: 90_000,

  // TUNE ME (Max): alert severity (1-10) thresholds for the line badges.
  // >= major -> red badge, >= minor -> amber badge, below -> listed quietly.
  ALERT_LEVELS: { major: 7, minor: 4 },

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
  REGIONAL_ROUTE_URL: './data/regional-routes.geojson',
  INFRASTRUCTURE_URL: './data/infrastructure.geojson',
  LOCAL_SERVICES_URL: './data/local-services.geojson',
  AIRPORTS_URL: './data/airports.geojson',
  BORDER_CROSSINGS_URL: './data/border-crossings.geojson',
  MNR_STOPS_URL: './data/mnr-stops.json',
  MNR_COLOR: '#ee0034',
  MNR_STALE_MS: 2 * 60_000,

  // Amtrak via the community Amtraker API (CORS-open, no key). Exact region
  // clipping is handled by the shared Census boundary filter.
  AMTRAK_URL: 'https://api-v3.amtraker.com/v3/trains',
  AMTRAK_BBOX: { latMin: 40.7, latMax: 47.75, lonMin: -74.1, lonMax: -65.8 },
  AMTRAK_COLOR: '#5b9bd5',
  AMTRAK_STALE_MS: 5 * 60_000,

  // Aircraft are fetched server-side from ADSB.lol. The selected geography
  // controls overlapping probes, then exact Census polygons clip the results.
  PLANE_COLOR: '#9be1ff',

  // AIS passes through the gateway so a provider key never enters the public
  // bundle. Traffic is relayed from the public 511 tile service and needs no
  // commercial API key.
  AIS_STALE_MS: 3 * 60_000, // dim vessels silent for 3 min
  AIS_PRUNE_MS: 10 * 60_000, // drop vessels silent for 10 min
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
  CAMERA_COLOR: '#d2d7dd',
  INCIDENT_COLOR: '#ff5c5c',
  ROAD_COLOR: '#8a949f',
  FREIGHT_COLOR: '#b98b72',
  WALK_COLOR: '#8bdc78',
  CYCLE_COLOR: '#45b7e8',
  LOCAL_COLOR: '#9fc36a',
  AIRPORT_COLOR: '#9be1ff',
  BORDER_COLOR: '#f0d27a',

  CAMERA_POLL_MS: 5 * 60_000,
  ROAD_EVENT_POLL_MS: 60_000,

  TRAFFIC_TILE_TEMPLATE: gatewayBase
    ? `${gatewayBase}/api/traffic/{z}/{x}/{y}.png`
    : '',
  WALK_TILE_TEMPLATE: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
  CYCLE_TILE_TEMPLATE: 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png',

  // Layer groups that start switched off (dense layers — one tap turns them
  // on: ~400 buses, ~600 bike stations, wall-to-wall traffic color).
  DEFAULT_OFF_GROUPS: [
    'bus', 'bike', 'roadwork', 'traffic', 'incident', 'camera',
    'roads', 'freight', 'walking', 'cycling', 'local', 'airport', 'border', 'air-service',
  ],

  BASEMAP_STYLE: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
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
