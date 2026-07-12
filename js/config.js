// Central knobs for the whole app. Everything tunable lives here.

const params = new URLSearchParams(window.location.search);

export const CONFIG = {
  API_BASE: 'https://api-v3.mbta.com',

  // MBTA API key (rate limit 1000 req/min vs 20 anonymous). Static sites ship
  // their keys in client JS by nature — this key is rate-limit-only, no
  // billing, and can be regenerated anytime at https://api-v3.mbta.com.
  // Override per-visit with ?api_key=YOUR_KEY.
  API_KEY: params.get('api_key') || 'd9bab356c0644656a933fd24f356b45f',

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
  // Wide enough for the full commuter rail network (Worcester/Providence/
  // Newburyport) plus harbor approaches.
  MAP_BOUNDS: [[-72.7, 41.2], [-69.5, 43.6]],

  // The Silver Line is GTFS route_type 3 ("bus") but belongs with rapid
  // transit — these six route IDs get their own layer group.
  SILVER_ROUTES: ['741', '742', '743', '746', '749', '751'],

  // Route ribbons are drawn for subway/SL/commuter rail/ferry — not the ~150
  // bus routes, which would bury the map. Geometry is static, so cache it.
  SHAPE_CACHE_KEY: 'bim-shapes-v2',
  SHAPE_CACHE_TTL_MS: 24 * 3600 * 1000,

  // Amtrak via the community Amtraker API (CORS-open, no key). We show trains
  // inside the map region only.
  AMTRAK_URL: 'https://api-v3.amtraker.com/v3/trains',
  AMTRAK_BBOX: { latMin: 41.2, latMax: 43.6, lonMin: -72.7, lonMax: -69.5 },
  AMTRAK_COLOR: '#5b9bd5',

  // Live aircraft via airplanes.live community ADS-B API (CORS-open, no key,
  // ~1 req/s courtesy limit — we poll every 45 s). Radius is nautical miles.
  PLANES_URL: 'https://api.airplanes.live/v2/point/42.36/-71.01/30',
  PLANE_COLOR: '#9be1ff',

  // Live harbor AIS via aisstream.io WebSocket. Needs a free key
  // (sign in with GitHub at https://aisstream.io) — paste it below, or pass
  // ?ais_key=YOUR_KEY once (it persists in this browser via localStorage).
  AIS_KEY: params.get('ais_key') || localStorage.getItem('bim-ais-key') || '',
  AIS_URL: 'wss://stream.aisstream.io/v0/stream',
  AIS_BBOX: [[41.2, -72.7], [43.6, -69.5]], // [[latMin, lonMin], [latMax, lonMax]]
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

  // Live road congestion via TomTom traffic flow tiles. Needs a free key
  // (https://developer.tomtom.com — no credit card) — paste it below, or pass
  // ?tomtom_key=YOUR_KEY once (it persists in this browser via localStorage).
  TOMTOM_KEY: params.get('tomtom_key') || localStorage.getItem('bim-tomtom-key') || '',
  TRAFFIC_TILE_TEMPLATE:
    'https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key={key}&thickness=10',

  // Layer groups that start switched off (dense layers — one tap turns them
  // on: ~400 buses, ~600 bike stations, wall-to-wall traffic color).
  DEFAULT_OFF_GROUPS: ['bus', 'bike', 'traffic'],

  BASEMAP_STYLE: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};

// Persist keys passed via URL so they survive future visits.
for (const [param, storageKey] of [
  ['ais_key', 'bim-ais-key'],
  ['tomtom_key', 'bim-tomtom-key'],
]) {
  if (params.get(param)) {
    try {
      localStorage.setItem(storageKey, params.get(param));
    } catch {
      /* private mode — session-only */
    }
  }
}
