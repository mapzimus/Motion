import { describe, expect, it } from 'vitest';
import { vehicleColors } from './vehicleColors.js';
import { assignPalette, paletteColorFor, routeShade } from './palette.js';
import { buildRouteKeyIndex, stampRouteColors } from './routeColors.js';
import { regionalVehicleItem } from '../feeds/regional-normalize.js';

const colorFor = (group: string, key: string, fallback: string) =>
  group === 'bus' && key === 'cj' ? '#5c88df' : fallback;
const routeCountFor = (_group: string, key: string) => (key === 'cj' ? 4 : 0);

describe('vehicleColors', () => {
  it('colors a palette-group vehicle by operator and shades it by route', () => {
    const c = vehicleColors({ group: 'bus', legendKey: 'cj', modeColor: '#f2b84b', shadeKey: 'cj:1' }, colorFor, routeCountFor);
    expect(c).toEqual({ color: '#5c88df', routeColor: routeShade('#5c88df', 'cj:1', 4) });
    expect(c!.routeColor).not.toBe('#5c88df');
  });

  it('falls back to the mode color, then the current color', () => {
    expect(vehicleColors({ group: 'bus', legendKey: 'x', modeColor: '#111111', color: '#222222' }, colorFor, routeCountFor)!.color).toBe('#111111');
    expect(vehicleColors({ group: 'bus', legendKey: 'x', color: '#222222' }, colorFor, routeCountFor)!.color).toBe('#222222');
  });

  it('uses the operator color as the route color without a shade key', () => {
    expect(vehicleColors({ group: 'bus', legendKey: 'cj', modeColor: '#f2b84b' }, colorFor, routeCountFor))
      .toEqual({ color: '#5c88df', routeColor: '#5c88df' });
  });

  it('leaves non-palette groups and keyless vehicles alone', () => {
    expect(vehicleColors({ group: 'red', legendKey: 'mbta', color: '#da291c' }, colorFor, routeCountFor)).toBeNull();
    expect(vehicleColors({ group: 'vessel', legendKey: 'cargo', color: '#8fd16b' }, colorFor, routeCountFor)).toBeNull();
    expect(vehicleColors({ group: 'bus', color: '#f2b84b' }, colorFor, routeCountFor)).toBeNull();
  });
});

describe('static routes and live vehicles agree', () => {
  it('gives a vehicle the opColor and routeColor of the route it runs on', () => {
    const route = (legendKey: string, id: string, kind: string) =>
      ({ properties: { kind, group: 'bus', legendKey, route: id, color: '#f2b84b' } as Record<string, any> });
    const features = [
      route('cj', 'cj:boston-south-station', 'regional-static'),
      route('cj', 'cj:logan', 'regional-static'),
      route('mbta', '7', 'mbta'),
      route('mbta', '77', 'mbta'),
      route('mbta', '238', 'mbta'),
    ];
    const index = buildRouteKeyIndex(features);
    const assignment = new Map([['bus', assignPalette('bus', [...index.get('bus')!].map(([key, e]) => ({ key, routes: e.routes, live: 0 })))]]);
    stampRouteColors(features, assignment, index);
    const resolve = (g: string, k: string, f: string) => paletteColorFor(g, k, assignment, f);
    const count = (g: string, k: string) => index.get(g)?.get(k)?.routes ?? 0;

    const regional = regionalVehicleItem(
      { id: 'v', feed: 'cj', agency: 'C&J', route: 'boston-south-station', lng: 0, lat: 0, updatedAt: '2026-10-05T12:00:00Z' },
      Date.parse('2026-10-05T12:00:00Z'),
      { ferryFeeds: [], busColor: '#f2b84b', ferryColor: '#2eb7c5', staleAfterMs: 120_000 },
    );
    const mbta = { group: 'bus', legendKey: 'mbta', modeColor: '#f2b84b', shadeKey: '7' };

    for (const [props, feature] of [[regional.props, features[0]], [mbta, features[2]]] as const) {
      const live = vehicleColors(props, resolve, count)!;
      expect(live.color).toBe(feature.properties.opColor);
      expect(live.routeColor).toBe(feature.properties.routeColor);
    }
    expect(features[0].properties.routeColor).not.toBe(features[0].properties.opColor);
  });
});
