import { describe, it, expect } from 'vitest';
import { buildRouteKeyIndex, stampRouteColors } from './routeColors.js';
import { assignPalette } from './palette.js';
import { setRouteKeyIndex, colorFor } from '../stores/legend.js';

const line = (group: string, legendKey: string, route: string, extra: Record<string, any> = {}) =>
  ({ properties: { kind: 'regional-static', group, legendKey, route, color: '#999999', ...extra } as Record<string, any> });
const station = (group: string, legendKey: string, routeIds: string[]) =>
  ({ properties: { kind: 'regional-station', group, legendKey, routeIds, color: '#999999' } });

describe('routeColors', () => {
  it('indexes routes, stops and the most common agency label', () => {
    const idx = buildRouteKeyIndex([
      line('bus', 'a', 'a:1', { agency: 'Alpha' }), line('bus', 'a', 'a:1', { agency: 'Alpha' }),
      line('bus', 'a', 'a:2', { agency: 'Beta' }), station('bus', 'a', ['a:1']),
      line('commuter', 'mbta', 'mbta:CR', {}), line('amtrak', 'amtrak', 'x'),
    ]);
    expect(idx.get('bus')!.get('a')).toEqual({ label: 'Alpha', routes: 2, stops: 1 });
    expect(idx.get('commuter')!.get('mbta')!.label).toBe('MBTA');
    expect(idx.has('amtrak')).toBe(false);
  });

  it('stamps the official color for commuter:metro-north, equal to colorFor', () => {
    const features = [line('commuter', 'metro-north', 'metro-north:1'), line('commuter', 'other', 'o:1')];
    const idx = buildRouteKeyIndex(features);
    setRouteKeyIndex(idx);
    const assignment = new Map([['commuter', assignPalette('commuter', [
      { key: 'metro-north', routes: 1, live: 0 }, { key: 'other', routes: 1, live: 0 }])]]);
    stampRouteColors(features, assignment, idx);
    expect(features[0].properties.opColor).toBe('#ee0034');
    expect(features[0].properties.opColor).toBe(colorFor('commuter', 'metro-north', '#000000'));
    expect(features[0].properties.routeColor).toBe('#ee0034'); // single route keeps operator color
  });

  it('clears stale colors on features outside the palette groups', () => {
    const f = { properties: { group: 'amtrak', legendKey: 'amtrak', opColor: '#111111', routeColor: '#222222' } };
    stampRouteColors([f], new Map(), new Map());
    expect(f.properties).not.toHaveProperty('opColor');
    expect(f.properties).not.toHaveProperty('routeColor');
  });
});
