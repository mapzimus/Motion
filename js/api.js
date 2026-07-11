// MBTA V3 API client. The API speaks JSON:API (data / included / relationships),
// so each fetcher flattens that into plain objects the rest of the app consumes.
// Sparse fieldsets (fields[...]) trim the full-fleet payload substantially.

import { CONFIG } from './config.js';

function buildUrl(path, params = {}) {
  const url = new URL(CONFIG.API_BASE + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (CONFIG.API_KEY) url.searchParams.set('api_key', CONFIG.API_KEY);
  return url;
}

export async function mbta(path, params) {
  const res = await fetch(buildUrl(path, params), {
    headers: { Accept: 'application/vnd.api+json' },
  });
  if (!res.ok) {
    const error = new Error(`MBTA API ${res.status} on ${path}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Every route the map can carry: subway/light rail (0,1), commuter rail (2),
// bus incl. Silver Line (3), ferry (4). One call; colors and names for all.
export async function fetchRoutes() {
  const json = await mbta('/routes', {
    'filter[type]': '0,1,2,3,4',
    'fields[route]': 'color,text_color,long_name,short_name,type,direction_destinations',
  });
  return json.data.map((r) => ({
    id: r.id,
    type: r.attributes.type,
    color: `#${r.attributes.color}`,
    textColor: `#${r.attributes.text_color}`,
    longName: r.attributes.long_name,
    shortName: r.attributes.short_name,
    destinations: r.attributes.direction_destinations,
  }));
}

// Returns the unique encoded polylines for a route (branches + both directions
// share geometry, so deduping by the encoded string trims the payload a lot).
export async function fetchShapes(routeId) {
  const json = await mbta('/shapes', { 'filter[route]': routeId, 'page[limit]': '100' });
  return [...new Set(json.data.map((s) => s.attributes.polyline))];
}

function summarizeOccupancy(carriages) {
  const pcts = carriages
    .map((c) => c.occupancy_percentage)
    .filter((p) => typeof p === 'number');
  if (!pcts.length) return '';
  const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  if (avg < 30) return 'Light crowding';
  if (avg < 60) return 'Moderate crowding';
  return 'Heavy crowding';
}

// The entire MBTA fleet — subway, commuter rail, buses, ferries — in ONE
// request (~500-900 vehicles at peak).
export async function fetchVehicles() {
  const json = await mbta('/vehicles', {
    'filter[route_type]': '0,1,2,3,4',
    include: 'stop',
    'fields[vehicle]':
      'latitude,longitude,bearing,current_status,direction_id,label,updated_at,carriages,revenue',
    'fields[stop]': 'name',
  });
  const stopNames = new Map(
    (json.included ?? [])
      .filter((item) => item.type === 'stop')
      .map((stop) => [stop.id, stop.attributes.name]),
  );
  return json.data
    .map((v) => ({
      id: v.id,
      route: v.relationships?.route?.data?.id,
      lng: v.attributes.longitude,
      lat: v.attributes.latitude,
      bearing: v.attributes.bearing,
      status: v.attributes.current_status,
      directionId: v.attributes.direction_id,
      label: v.attributes.label,
      stopName: stopNames.get(v.relationships?.stop?.data?.id) ?? '',
      updatedAt: v.attributes.updated_at,
      occupancy: summarizeOccupancy(v.attributes.carriages ?? []),
      revenue: v.attributes.revenue,
    }))
    .filter(
      (v) =>
        v.route &&
        Number.isFinite(v.lng) &&
        Number.isFinite(v.lat) &&
        v.revenue !== 'NON_REVENUE',
    );
}

export async function fetchAlerts() {
  const json = await mbta('/alerts', {
    'filter[route_type]': '0,1,2,3,4',
    'filter[datetime]': 'NOW',
  });
  return json.data.map((a) => {
    const entities = a.attributes.informed_entity ?? [];
    return {
      id: a.id,
      effect: a.attributes.effect,
      severity: a.attributes.severity,
      header: a.attributes.header,
      routes: [...new Set(entities.map((e) => e.route).filter(Boolean))],
      stops: [...new Set(entities.map((e) => e.stop).filter(Boolean))],
    };
  });
}

// Locations for the stops an alert names, so clicking it can fly there.
export async function fetchStopCoords(stopIds) {
  if (!stopIds.length) return new Map();
  const json = await mbta('/stops', {
    'filter[id]': stopIds.join(','),
    'fields[stop]': 'latitude,longitude',
    'page[limit]': '300',
  });
  return new Map(
    json.data
      .filter((s) => Number.isFinite(s.attributes.longitude))
      .map((s) => [s.id, [s.attributes.longitude, s.attributes.latitude]]),
  );
}
