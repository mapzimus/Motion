export const REGION_IDS = [
  'boston',
  'ma',
  'ct',
  'ri',
  'nh',
  'vt',
  'me',
  'new-england',
] as const;

export type RegionId = (typeof REGION_IDS)[number];
export type StateId = Exclude<RegionId, 'boston' | 'new-england'>;

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
  'new-england': [[40.8, -74.0], [47.7, -66.0]],
};

type PlaneProbe = { lat: number; lon: number; radius: number };

export const PLANE_PROBES: Record<RegionId, PlaneProbe[]> = {
  boston: [{ lat: 42.36, lon: -71.01, radius: 60 }],
  ma: [{ lat: 42.18, lon: -71.8, radius: 145 }],
  ct: [{ lat: 41.6, lon: -72.7, radius: 95 }],
  ri: [{ lat: 41.68, lon: -71.5, radius: 70 }],
  nh: [{ lat: 43.85, lon: -71.55, radius: 125 }],
  vt: [{ lat: 44.05, lon: -72.7, radius: 125 }],
  me: [
    { lat: 44.1, lon: -69.9, radius: 160 },
    { lat: 46.1, lon: -68.4, radius: 150 },
  ],
  'new-england': [
    { lat: 41.75, lon: -72.5, radius: 120 },
    { lat: 42.8, lon: -71.3, radius: 125 },
    { lat: 44.25, lon: -72.0, radius: 150 },
    { lat: 45.5, lon: -68.8, radius: 180 },
  ],
};
