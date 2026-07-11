// Central knobs for the whole app. Everything tunable lives here.

export const CONFIG = {
  API_BASE: 'https://api-v3.mbta.com',

  // Optional MBTA API key. Anonymous access allows 20 requests/minute, which
  // this app stays under; a free key (https://api-v3.mbta.com) raises it to 1000/min.
  // Can also be supplied at runtime: ?api_key=YOUR_KEY on the URL.
  API_KEY: new URLSearchParams(window.location.search).get('api_key') || '',

  // Polling cadence. Budget: vehicles 6/min + alerts 1/min = 7/min (limit 20/min anonymous).
  VEHICLE_POLL_MS: 10_000,
  ALERT_POLL_MS: 60_000,

  // How long markers glide between polled positions.
  ANIMATE_MS: 900,

  // A train whose last GPS report is older than this renders dimmed.
  STALE_AFTER_MS: 90_000,

  // TUNE ME (Max): alert severity (1-10) thresholds for the line badges.
  // >= major -> red badge, >= minor -> amber badge, below -> listed quietly.
  ALERT_LEVELS: { major: 7, minor: 4 },

  MAP_CENTER: [-71.0589, 42.335],
  MAP_ZOOM: 11.5,
  MAP_BOUNDS: [[-71.75, 41.95], [-70.35, 42.75]], // keep panning within greater Boston

  // v1 scope: the rapid transit system as riders know it. We filter by explicit
  // route list rather than GTFS route_type, because the Silver Line is
  // technically "bus" (type 3) yet belongs on any Boston rapid-transit map.
  // 741-746 = SL1/SL2/SL3/SLW (waterfront BRT), 749/751 = SL5/SL4 (Washington St).
  RAPID_TRANSIT_ROUTES: [
    'Red', 'Mattapan', 'Orange', 'Blue',
    'Green-B', 'Green-C', 'Green-D', 'Green-E',
    '741', '742', '743', '746', '749', '751',
  ],

  // Route ribbons are static geometry — cache them locally for a day so
  // repeat visits skip 14 shape requests.
  SHAPE_CACHE_KEY: 'bim-shapes-v1',
  SHAPE_CACHE_TTL_MS: 24 * 3600 * 1000,

  BASEMAP_STYLE: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};
