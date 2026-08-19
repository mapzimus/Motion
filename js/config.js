// Central knobs for the whole app. Everything tunable lives here.

const params = new URLSearchParams(window.location.search);
const gatewayBase = (
  params.get('gateway') || localStorage.getItem('motion-gateway') || ''
).replace(/\/+$/, '');

export const CONFIG = {
  API_BASE: 'https://api-v3.mbta.com',

  // MBTA API key (rate limit 1000 req/min vs 20 anonymous). Static sites ship
  // their keys in client JS by nature — this key is rate-limit-only, no
  // billing, and can be regenerated anytime at https://api-v3.mbta.com.
  // Override per-visit with ?api_key=YOUR_KEY.
  API_KEY: params.get('api_key') || 'd9bab356c0644656a933fd24f356b45f',

  // Worker gateway for feeds that cannot safely or reliably run in a browser.
  // Override once with ?gateway=http://localhost:8787; it persists.
  GATEWAY_BASE: gatewayBase,

  // Polling cadence per feed.
  VEHICLE_POLL_MS: 10_000, // one request covers the entire MBTA fleet
  ALERT_POLL_MS: 60_000,
  AMTRAK_POLL_MS: 90_000, // Amtraker returns every US train (~1 MB) — be kind
  PLANE_POLL_MS: 45_000,

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
  SHAPE_CACHE_KEY: 'bim-shapes-v3',
  SHAPE_CACHE_TTL_MS: 24 * 3600 * 1000,

  // Amtrak via the community Amtraker API (CORS-open, no key). Exact region
  // clipping is handled by the shared Census boundary filter.
  AMTRAK_URL: 'https://api-v3.amtraker.com/v3/trains',
  AMTRAK_BBOX: { latMin: 40.7, latMax: 47.75, lonMin: -74.1, lonMax: -65.8 },
  AMTRAK_COLOR: '#5b9bd5',

  // Aircraft are fetched server-side from ADSB.lol. The selected geography
  // controls overlapping probes, then exact Census polygons clip the results.
  PLANE_COLOR: '#9be1ff',

  // AIS and protected traffic tiles also pass through the gateway, so vendor
  // keys never enter browser storage or the public JavaScript bundle.
  AIS_STALE_MS: 3 * 60_000, // dim vessels silent for 3 min
  AIS_PRUNE_MS: 10 * 60_000, // drop vessels silent for 10 min
  VESSEL_COLOR: '#63d8c8',

  // Bluebikes stations via the public GBFS feed (keyless, CORS-open).
  // Stations don't move, but fill levels are live.
  BIKE_INFO_URL: 'https://gbfs.bluebikes.com/gbfs/en/station_information.json',
  BIKE_STATUS_URL: 'https://gbfs.bluebikes.com/gbfs/en/station_status.json',
  BIKE_POLL_MS: 60_000,
  BIKE_COLOR: '#4d9fec', // stocked
  BIKE_LOW_COLOR: '#ffb454', // 1-2 bikes left
  BIKE_EMPTY_COLOR: '#5c6570', // empty (also renders dimmed)

  // Mode-icon fill colors (map sprites are pre-rendered at startup).
  BUS_COLOR: '#ffc72c', // MBTA bus yellow
  FERRY_COLOR: '#008eaa', // MBTA ferry teal

  TRAFFIC_TILE_TEMPLATE: gatewayBase
    ? `${gatewayBase}/api/traffic/{z}/{x}/{y}.png`
    : '',

  // Layer groups that start switched off (dense layers — one tap turns them
  // on: ~400 buses, ~600 bike stations, wall-to-wall traffic color).
  DEFAULT_OFF_GROUPS: ['bus', 'bike', 'traffic'],

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
