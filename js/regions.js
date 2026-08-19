// Geography presets and exact point-in-polygon filtering. Boundaries are
// generalized Census TIGERweb 2025 features checked into data/regions.geojson.

export const REGIONS = [
  { key: 'boston', name: 'Boston only' },
  { key: 'ma', name: 'Massachusetts' },
  { key: 'ct', name: 'Connecticut' },
  { key: 'ri', name: 'Rhode Island' },
  { key: 'nh', name: 'New Hampshire' },
  { key: 'vt', name: 'Vermont' },
  { key: 'me', name: 'Maine' },
  { key: 'new-england', name: 'All New England' },
];

const STATE_KEYS = ['ct', 'me', 'ma', 'nh', 'ri', 'vt'];
const EMPTY_FC = { type: 'FeatureCollection', features: [] };
const featureByKey = new Map();
let activeRegion = 'boston';

export const isRegionKey = (key) => REGIONS.some((region) => region.key === key);

export async function loadRegions() {
  const response = await fetch(new URL('../data/regions.geojson', import.meta.url));
  if (!response.ok) throw new Error(`Region boundaries ${response.status}`);
  const collection = await response.json();
  for (const feature of collection.features ?? []) {
    featureByKey.set(feature.properties.key, feature);
  }
  if (!featureByKey.has('boston') || STATE_KEYS.some((key) => !featureByKey.has(key))) {
    throw new Error('Region boundary file is incomplete');
  }
}

export function initialRegion() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('region') || localStorage.getItem('motion-region');
  return isRegionKey(requested) ? requested : 'boston';
}

export function setActiveRegion(key) {
  activeRegion = isRegionKey(key) ? key : 'boston';
  try {
    localStorage.setItem('motion-region', activeRegion);
  } catch {
    // Private mode: keeping it for this visit is enough.
  }
  const url = new URL(window.location.href);
  if (activeRegion === 'boston') url.searchParams.delete('region');
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

export function containsPoint(key, point) {
  const keys = key === 'new-england' ? STATE_KEYS : [key];
  return keys.some((regionKey) => {
    const feature = featureByKey.get(regionKey);
    return feature ? pointInGeometry(point, feature.geometry) : false;
  });
}

export function filterItems(items, key = activeRegion) {
  return items.filter((item) => containsPoint(key, [item.lng, item.lat]));
}

export function filterFeatureCollection(collection, key = activeRegion) {
  return {
    type: 'FeatureCollection',
    features: collection.features.filter((feature) =>
      feature.geometry?.type === 'Point' && containsPoint(key, feature.geometry.coordinates),
    ),
  };
}

// Lines and polygons are kept when at least one vertex falls inside the
// selected boundary. Moving points use the stricter point-only helper above.
export function filterSpatialFeatureCollection(collection, key = activeRegion) {
  return {
    type: 'FeatureCollection',
    features: collection.features.filter((feature) => {
      let inside = false;
      visitCoordinates(feature.geometry?.coordinates ?? [], (coordinate) => {
        if (!inside && containsPoint(key, coordinate)) inside = true;
      });
      return inside;
    }),
  };
}

export function boundaryForRegion(key) {
  const keys = key === 'new-england' ? STATE_KEYS : [key];
  return {
    type: 'FeatureCollection',
    features: keys.map((regionKey) => featureByKey.get(regionKey)).filter(Boolean),
  };
}

function visitCoordinates(value, callback) {
  if (!Array.isArray(value) || !value.length) return;
  if (typeof value[0] === 'number') callback(value);
  else for (const child of value) visitCoordinates(child, callback);
}

export function boundsForRegion(key) {
  const boundary = boundaryForRegion(key);
  if (!boundary.features.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const feature of boundary.features) {
    visitCoordinates(feature.geometry.coordinates, ([lng, lat]) => {
      west = Math.min(west, lng);
      south = Math.min(south, lat);
      east = Math.max(east, lng);
      north = Math.max(north, lat);
    });
  }
  return [[west, south], [east, north]];
}

export function emptyBoundary() {
  return EMPTY_FC;
}
