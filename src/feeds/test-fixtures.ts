// Three boxes standing in for MA, NH and a North Shore sub-region.
const box = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon',
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});
const region = (key: string, kind: string, geometry: object, extra: Record<string, unknown> = {}) => ({
  type: 'Feature',
  properties: { key, name: key, group: 'ma', kind, ...extra },
  geometry,
});

export const regionFixture = {
  metadata: {
    order: ['ma', 'north-shore', 'nh', 'new-england'],
    groups: [{ key: 'ma', label: 'Massachusetts' }],
    virtualRegions: [{
      key: 'new-england', name: 'All New England', group: 'ma', kind: 'union', members: ['ma', 'nh'],
    }],
  },
  features: [
    region('ma', 'state', box(-73.5, 41.2, -69.9, 42.9)),
    region('nh', 'state', box(-72.6, 42.9, -70.6, 45.3)),
    region('north-shore', 'towns', box(-71.0, 42.4, -70.6, 42.75), { parent: 'ma' }),
  ],
};
