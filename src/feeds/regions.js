// Geography presets and exact point-in-polygon filtering. Boundaries are
// generalized Census TIGERweb features built from scripts/regions-config.json
// into data/regions.geojson. Every region's name, picker group, parent and
// flags come from that file, so adding a region needs no code change here.
// Vessels and aircraft use data/regions-marine.geojson instead ({ marine: true }): the same
// regions grown by a coastal buffer so ships on the water are not clipped away.

// Filled by loadRegions() in picker order. Other modules import these arrays
// and read them after startup.
export const REGIONS = [];
export const REGION_GROUPS = [];

// First-time visitors land here.
export const DEFAULT_REGION = 'greater-boston';
// What an old link or saved setting without a region meant before Greater
// Boston existed: the MBTA core, which keeps the `boston` key.
export const LEGACY_DEFAULT_REGION = 'boston';

export const STATE_KEYS = ['ct', 'me', 'ma', 'nh', 'ri', 'vt'];
// Region ids the Motion gateway and aircraft relay understand. Sub-regions ask
// the gateway for their parent and are clipped to their own boundary here.
const GATEWAY_KEYS = new Set(['boston', ...STATE_KEYS, 'new-england']);
const EMPTY_FC = { type: 'FeatureCollection', features: [] };
const featureByKey = new Map();
const regionByKey = new Map();
const marineByKey = new Map();
const bboxByKey = new Map();
let activeRegion = DEFAULT_REGION;

export const isRegionKey = (key) => typeof key === 'string' && regionByKey.has(key);

export const regionInfo = (key) => regionByKey.get(key) ?? null;

export const regionName = (key) => regionByKey.get(key)?.name ?? key;

export const hasSubway = (key) => Boolean(regionByKey.get(key)?.hasSubway);

export const busDefaultOn = (key) => Boolean(regionByKey.get(key)?.busDefaultOn);

// The region id to send to the gateway: sub-regions resolve to their parent
// (a state, or `new-england` for regions that cross a state line).
export function gatewayRegion(key) {
  let current = key;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (GATEWAY_KEYS.has(current)) return current;
    current = regionByKey.get(current)?.parent;
  }
  return 'new-england';
}

// Turn a loaded region collection into the registry. Exported for tests.
export function registerRegions(collection, marineCollection = null) {
  featureByKey.clear();
  marineByKey.clear();
  for (const feature of marineCollection?.features ?? []) {
    if (feature.properties?.key) marineByKey.set(feature.properties.key, feature);
  }
  regionByKey.clear();
  bboxByKey.clear();
  regionBoundsCache.clear();
  REGIONS.length = 0;
  REGION_GROUPS.length = 0;
  const metadata = collection.metadata ?? {};
  const entries = new Map();
  for (const feature of collection.features ?? []) {
    const properties = feature.properties ?? {};
    if (!properties.key) continue;
    featureByKey.set(properties.key, feature);
    entries.set(properties.key, properties);
  }
  const virtual = metadata.virtualRegions?.length
    ? metadata.virtualRegions
    : [{ key: 'new-england', name: 'All New England', group: 'new-england', kind: 'union', members: STATE_KEYS, hasSubway: true }];
  for (const region of virtual) entries.set(region.key, region);
  const order = metadata.order?.length ? metadata.order : [...entries.keys()];
  for (const key of order) {
    const properties = entries.get(key);
    if (!properties) continue;
    const region = {
      key,
      name: properties.name ?? key,
      group: properties.group ?? 'new-england',
      parent: properties.parent ?? null,
      kind: properties.kind ?? 'counties',
      members: properties.members ?? [],
      hasSubway: Boolean(properties.hasSubway),
      busDefaultOn: Boolean(properties.busDefaultOn),
      definition: properties.definition ?? '',
    };
    REGIONS.push(region);
    regionByKey.set(key, region);
  }
  for (const group of metadata.groups ?? []) REGION_GROUPS.push({ key: group.key, label: group.label });
  for (const region of REGIONS) {
    if (!REGION_GROUPS.some((group) => group.key === region.group)) {
      REGION_GROUPS.push({ key: region.group, label: region.group });
    }
  }
}

async function fetchMarine() {
  try {
    const base = import.meta.env?.BASE_URL ?? './';
    const response = await fetch(`${base}data/regions-marine.geojson`, { signal: AbortSignal.timeout(20_000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null; // Vessels fall back to the land boundary.
  }
}

export async function loadRegions() {
  const base = import.meta.env?.BASE_URL ?? './';
  const [response, marine] = await Promise.all([
    fetch(`${base}data/regions.geojson`, { signal: AbortSignal.timeout(20_000) }),
    fetchMarine(),
  ]);
  if (!response.ok) throw new Error(`Region boundaries ${response.status}`);
  registerRegions(await response.json(), marine);
  const required = ['boston', DEFAULT_REGION, ...STATE_KEYS];
  if (required.some((key) => !featureByKey.has(key))) {
    throw new Error('Region boundary file is incomplete');
  }
}

export function initialRegion() {
  const params = new URLSearchParams(window.location.search);
  let saved = null;
  try {
    saved = localStorage.getItem('motion-region');
  } catch {
    // Storage blocked: fall through to the default.
  }
  const requested = params.get('region') || saved;
  return isRegionKey(requested) ? requested : DEFAULT_REGION;
}

export function setActiveRegion(key) {
  activeRegion = isRegionKey(key) ? key : DEFAULT_REGION;
  try {
    localStorage.setItem('motion-region', activeRegion);
  } catch {
    // Private mode: keeping it for this visit is enough.
  }
  const url = new URL(window.location.href);
  if (activeRegion === DEFAULT_REGION) url.searchParams.delete('region');
  else url.searchParams.set('region', activeRegion);
  history.replaceState(null, '', url);
}

export const getActiveRegion = () => activeRegion;

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function pointInGeometry(point, geometry) {
  if (geometry.type === 'Polygon') return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  }
  return false;
}

// Keys whose boundaries make up a region: the six states for `new-england`
// (or any other union), otherwise the region itself.
function boundaryKeys(key) {
  const region = regionByKey.get(key);
  if (region?.kind === 'union') return region.members;
  if (key === 'new-england') return STATE_KEYS;
  return [key];
}

function featureBbox(key) {
  if (!bboxByKey.has(key)) {
    const feature = featureByKey.get(key);
    bboxByKey.set(key, feature ? coordinateBounds(feature.geometry.coordinates) : null);
  }
  return bboxByKey.get(key);
}

export function containsPoint(key, point, { marine = false } = {}) {
  if (marine) {
    const feature = marineByKey.get(key);
    if (feature) return pointInGeometry(point, feature.geometry);
  }
  return boundaryKeys(key).some((regionKey) => {
    const feature = featureByKey.get(regionKey);
    if (!feature) return false;
    // A cheap box test first: most points are nowhere near most regions.
    const bbox = featureBbox(regionKey);
    if (bbox && (point[0] < bbox[0][0] || point[0] > bbox[1][0]
      || point[1] < bbox[0][1] || point[1] > bbox[1][1])) return false;
    return pointInGeometry(point, feature.geometry);
  });
}

export function stateAt(point) {
  return STATE_KEYS.find((key) => containsPoint(key, point)) ?? null;
}

// The smallest region (by bounding-box area) that contains the point. Unions
// such as All New England contain everything, so they are skipped.
export function smallestRegionAt(point) {
  let best = null;
  let bestArea = Infinity;
  for (const region of REGIONS) {
    if (region.kind === 'union' || !containsPoint(region.key, point)) continue;
    const bounds = boundsForRegion(region.key);
    if (!bounds) continue;
    const area = (bounds[1][0] - bounds[0][0]) * (bounds[1][1] - bounds[0][1]);
    if (area < bestArea) {
      best = region.key;
      bestArea = area;
    }
  }
  return best;
}

// Fleets clipped to the coastal (marine) boundary instead of land: vessels sit
// on the water, and aircraft fly over it (Logan approaches cross the harbor).
const MARINE_FLEETS = new Set(['vessel', 'plane']);
export const fleetBoundaryOptions = (fleetId) => ({ marine: MARINE_FLEETS.has(fleetId) });

export function filterItems(items, key = activeRegion, options = {}) {
  return items.filter((item) => containsPoint(key, [item.lng, item.lat], options));
}

export function filterFeatureCollection(collection, key = activeRegion, options = {}) {
  return {
    type: 'FeatureCollection',
    features: collection.features.filter((feature) =>
      feature.geometry?.type === 'Point' && containsPoint(key, feature.geometry.coordinates, options),
    ),
  };
}

// True when at least one vertex of a line or polygon falls inside the region.
// Feature bounds are cached so repeated region switches skip far-away shapes.
const shapeBounds = new WeakMap();
export function featureTouchesRegion(feature, key = activeRegion) {
  const coordinates = feature.geometry?.coordinates;
  if (!coordinates) return false;
  let bounds = shapeBounds.get(feature);
  if (bounds === undefined) {
    bounds = coordinateBounds(coordinates);
    shapeBounds.set(feature, bounds);
  }
  const region = boundsForRegion(key);
  if (!bounds || !region) return false;
  if (bounds[1][0] < region[0][0] || bounds[0][0] > region[1][0]
    || bounds[1][1] < region[0][1] || bounds[0][1] > region[1][1]) return false;
  let inside = false;
  visitCoordinates(coordinates, (coordinate) => {
    if (!inside && containsPoint(key, coordinate)) inside = true;
  });
  return inside;
}

// Lines and polygons are kept when at least one vertex falls inside the
// selected boundary. Moving points use the stricter point-only helper above.
export function filterSpatialFeatureCollection(collection, key = activeRegion) {
  return {
    type: 'FeatureCollection',
    features: collection.features.filter((feature) => featureTouchesRegion(feature, key)),
  };
}

export function boundaryForRegion(key) {
  return {
    type: 'FeatureCollection',
    features: boundaryKeys(key).map((regionKey) => featureByKey.get(regionKey)).filter(Boolean),
  };
}

function visitCoordinates(value, callback) {
  if (!Array.isArray(value) || !value.length) return;
  if (typeof value[0] === 'number') callback(value);
  else for (const child of value) visitCoordinates(child, callback);
}

function coordinateBounds(coordinates) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  visitCoordinates(coordinates, ([lng, lat]) => {
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  });
  return Number.isFinite(west) ? [[west, south], [east, north]] : null;
}

const regionBoundsCache = new Map();
export function boundsForRegion(key) {
  if (regionBoundsCache.has(key)) return regionBoundsCache.get(key);
  const boundary = boundaryForRegion(key);
  if (!boundary.features.length) return null;
  let bounds = null;
  for (const feature of boundary.features) {
    const next = featureBbox(feature.properties.key) ?? coordinateBounds(feature.geometry.coordinates);
    if (!next) continue;
    bounds = bounds
      ? [[Math.min(bounds[0][0], next[0][0]), Math.min(bounds[0][1], next[0][1])],
        [Math.max(bounds[1][0], next[1][0]), Math.max(bounds[1][1], next[1][1])]]
      : next;
  }
  if (bounds) regionBoundsCache.set(key, bounds);
  return bounds;
}

// How far the camera may zoom when fitting a region: small regions may come
// closer than a whole state. Matches the old fixed values at both ends
// (MBTA core about 11.4, states and larger 8.8).
export function maxZoomForRegion(key) {
  const bounds = boundsForRegion(key);
  if (!bounds) return 8.8;
  const span = Math.max(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], 0.01);
  const zoom = Math.log2(360 / span) + 2;
  return Math.min(12, Math.max(8.8, Math.round(zoom * 10) / 10));
}

export function emptyBoundary() {
  return EMPTY_FC;
}
