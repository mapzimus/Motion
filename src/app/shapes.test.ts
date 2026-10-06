import { describe, it, expect } from 'vitest';
import { annotateLegendKeys } from './shapes.js';

const f = (properties: Record<string, unknown>) =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties }) as any;

describe('annotateLegendKeys', () => {
  it('sets legendKey on lines, stations and MBTA shapes, and returns the same array', () => {
    const features = [
      f({ kind: 'regional-static', route: 'cttransit-hartford:1' }),
      f({ kind: 'regional-station', routeIds: ['mbta-stations:749'] }),
      f({ kind: 'mbta', route: '1' }),
      f({ kind: 'other' }),
    ];
    expect(annotateLegendKeys(features)).toBe(features);
    expect(features.map((x) => x.properties.legendKey)).toEqual(['cttransit-hartford', 'mbta', 'mbta', '']);
  });
});
