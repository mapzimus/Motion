import { describe, expect, it } from 'vitest';
import { areaKeysForRegion, registerRegions } from './regions.js';

const collection = {
  metadata: {
    order: ['boston', 'ma', 'north-shore', 'ct', 'vt', 'nh', 'upper-valley', 'philadelphia', 'new-england', 'northeast'],
    groups: [],
    virtualRegions: [
      { key: 'new-england', name: 'All New England', group: 'new-england', kind: 'union', members: ['ma', 'ct', 'vt', 'nh'] },
      { key: 'northeast', name: 'All Northeast', group: 'northeast', kind: 'union', members: ['new-england', 'philadelphia'] },
    ],
  },
  features: [
    ['boston', 'ma', 'towns'], ['ma', 'new-england', 'state'], ['north-shore', 'ma', 'towns'],
    ['ct', 'new-england', 'state'], ['vt', 'new-england', 'state'], ['nh', 'new-england', 'state'],
    ['upper-valley', 'new-england', 'counties'], ['philadelphia', null, 'counties'],
  ].map(([key, parent, kind]) => ({
    type: 'Feature',
    properties: { key, parent, kind, name: key },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  })),
};

describe('scheduled-route areas for a region', () => {
  registerRegions(collection as any);
  it('resolves sub-regions to their state and keeps top-level metros as themselves', () => {
    expect(areaKeysForRegion('boston')).toEqual(['ma']);
    expect(areaKeysForRegion('north-shore')).toEqual(['ma']);
    expect(areaKeysForRegion('ma')).toEqual(['ma']);
    expect(areaKeysForRegion('upper-valley')).toEqual(['upper-valley']);
    expect(areaKeysForRegion('philadelphia')).toEqual(['philadelphia']);
  });
  it('expands unions to every member area, recursively', () => {
    expect(areaKeysForRegion('new-england')).toEqual(['ma', 'ct', 'vt', 'nh']);
    expect(areaKeysForRegion('northeast')).toEqual(['ma', 'ct', 'vt', 'nh', 'philadelphia']);
    expect(areaKeysForRegion('nowhere')).toEqual([]);
  });
});
