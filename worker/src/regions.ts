export const REGION_IDS = [
  'boston',
  'ma',
  'ct',
  'ri',
  'nh',
  'vt',
  'me',
  'ny',
  'nj',
  'new-england',
  'northeast',
  // Metro areas outside the Northeast union, each its own top-level region.
  'philadelphia',
  'washington',
  'chicago',
  'bay-area',
] as const;

export type RegionId = (typeof REGION_IDS)[number];
// An area a feed can belong to: a state or a metro (not the MBTA core or a union).
export type AreaId = Exclude<RegionId, 'boston' | 'new-england' | 'northeast'>;
export type StateId = AreaId;
export const NEW_ENGLAND_STATE_IDS: readonly AreaId[] = ['ma', 'ct', 'ri', 'nh', 'vt', 'me'];
export const METRO_IDS: readonly AreaId[] = ['philadelphia', 'washington', 'chicago', 'bay-area'];
export const NORTHEAST_AREA_IDS: readonly AreaId[] = [...NEW_ENGLAND_STATE_IDS, 'ny', 'nj'];
// Union regions: `new-england` is the six states; `northeast` adds New York
// and New Jersey.
export const UNION_REGION_IDS: readonly RegionId[] = ['new-england', 'northeast'];

export const isRegionId = (value: string | null): value is RegionId =>
  REGION_IDS.includes(value as RegionId);

// AISStream uses [[south, west], [north, east]]. These deliberately include a
// small coastal margin so vessels just outside state waters do not blink out.
export const AIS_BOUNDS: Record<RegionId, [[number, number], [number, number]]> = {
  boston: [[42.15, -71.25], [42.55, -70.65]],
  ma: [[41.15, -73.65], [43.05, -69.75]],
  ct: [[40.85, -73.8], [42.15, -71.7]],
  ri: [[41.05, -71.95], [42.1, -70.95]],
  nh: [[42.65, -72.7], [45.35, -70.55]],
  vt: [[42.65, -73.55], [45.1, -71.35]],
  me: [[42.8, -71.2], [47.65, -66.0]],
  ny: [[40.45, -79.8], [45.05, -71.75]],
  nj: [[38.85, -75.6], [41.4, -73.85]],
  'new-england': [[40.8, -74.0], [47.7, -66.0]],
  northeast: [[38.8, -80.0], [47.7, -66.0]],
  philadelphia: [[39.6, -75.9], [40.6, -74.4]],
  washington: [[38.3, -77.9], [39.5, -76.3]],
  chicago: [[41.2, -88.7], [42.6, -86.8]],
  'bay-area': [[36.9, -123.3], [38.9, -121.4]],
};

// Outer envelope of the whole map (the continental United States), shared by
// every feed that needs a coarse "is this point in our map area?" check.
// Per-region clipping happens in the browser against Census boundaries.
export const MAP_BBOX = { west: -125, south: 24, east: -66, north: 50 } as const;
// The six-state box the AIS hub still subscribes to (see ais-hub.ts).
export const NEW_ENGLAND_BBOX = { west: -74, south: 40.8, east: -66, north: 47.7 } as const;

export function insideMapArea(lng: number, lat: number): boolean {
  return lng >= MAP_BBOX.west && lng <= MAP_BBOX.east &&
    lat >= MAP_BBOX.south && lat <= MAP_BBOX.north;
}

// Older name kept for callers and tests; it now means the whole map area.
export const insideNewEngland = insideMapArea;
