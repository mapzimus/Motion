import { describe, expect, it, afterEach } from 'vitest';
import { assignRouteColors, clearRouteColors, drillColorFor, drillKey, drillLabel, getRouteColorMap } from './routePalette.js';

afterEach(() => clearRouteColors());

describe('drill route keys', () => {
  it('uses the shared shade id so a vehicle and its ribbon match', () => {
    expect(drillKey({ route: '9', shadeKey: 'cttransit:9' })).toBe('cttransit:9');
    expect(drillKey({ properties: { route: 'Green-E', shadeKey: 'Green-E' } })).toBe('Green-E');
    expect(drillLabel({ route: '9', shadeKey: 'cttransit:9' })).toBe('9');
    expect(drillLabel({ route: 'New Haven', shadeKey: 'metro-north:NH' })).toBe('New Haven');
    expect(drillLabel({ route: 'Green-E', shadeKey: 'Green-E' })).toBe('Green-E');
  });

  it('colors each shade id, not the short route number', () => {
    assignRouteColors([
      { properties: { group: 'bus', route: '9', shadeKey: 'cttransit:9' } },
      { properties: { group: 'bus', route: '9', shadeKey: 'mbta' } },
    ], 'bus');
    const colors = getRouteColorMap();
    expect([...colors.keys()]).toEqual(['cttransit:9', 'mbta']);
    expect(drillColorFor({ group: 'bus', legendKey: 'cttransit', route: '9', shadeKey: 'cttransit:9' })?.color)
      .toBe(colors.get('cttransit:9'));
    expect(drillColorFor({ group: 'ferry', route: '9', shadeKey: 'cttransit:9' })).toBeNull();
  });

  it('limits colors to the drilled operator', () => {
    assignRouteColors([
      { properties: { group: 'bus', route: '1', shadeKey: '1' } },
    ], 'bus', 'mbta');
    expect(drillColorFor({ group: 'bus', legendKey: 'mbta', route: '1', shadeKey: '1' })).not.toBeNull();
    expect(drillColorFor({ group: 'bus', legendKey: 'cttransit', route: '1', shadeKey: 'cttransit:1' })).toBeNull();
  });
});
