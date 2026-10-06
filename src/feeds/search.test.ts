import { beforeAll, describe, expect, it } from 'vitest';
import { registerRegions } from './regions.js';
import { regionForEntry, search, setSearchAirports, setSearchFeatures } from './search.js';
import { regionFixture } from './test-fixtures.js';

const stop = (title: string, lng: number, lat: number) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { kind: 'regional-station', title, stopKind: 'station', status: '' },
});
const line = (route: string, coordinates: number[][]) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties: { kind: 'regional-static', route, name: route, agency: 'Test' },
});

// search() is plain JS whose inferred result is a loose union of entry shapes.
const find = (query: string): any[] => search(query) as any[];

beforeAll(() => {
  registerRegions(regionFixture);
  setSearchFeatures([
    stop('Salem Depot', -70.9, 42.52),
    stop('Salem Depot', -71.2, 43.0),
    stop('Boston Garden', -71.06, 42.36),
  ]);
});

describe('municipality search', () => {
  it('keeps same-named towns in different states apart', () => {
    const salems = find('salem').filter((entry) => entry.type === 'municipality');
    expect(salems.map((entry) => entry.name).sort()).toEqual(['Salem, MA', 'Salem, NH']);
    const [ma, nh] = ['Salem, MA', 'Salem, NH'].map((name) => salems.find((entry) => entry.name === name));
    expect(ma.center[1]).toBeLessThan(42.9);
    expect(nh.center[1]).toBeGreaterThan(42.9);
  });

  it('leaves unambiguous towns unlabeled', () => {
    const boston = find('boston').find((entry) => entry.type === 'municipality');
    expect(boston.name).toBe('Boston');
  });
});

describe('regionForEntry', () => {
  const gloucesterStop = { type: 'stop', lng: -70.66, lat: 42.6 };

  it('switches to the narrowest region holding a result outside the active one', () => {
    expect(regionForEntry(gloucesterStop, 'nh')).toBe('north-shore');
  });

  it('stays put when the active region already covers it', () => {
    expect(regionForEntry(gloucesterStop, 'ma')).toBeNull();
    expect(regionForEntry(gloucesterStop, 'north-shore')).toBeNull();
    expect(regionForEntry(gloucesterStop, 'new-england')).toBeNull();
  });

  it('handles municipalities and routes', () => {
    expect(regionForEntry({ type: 'municipality', center: [-71.2, 43.0] }, 'ma')).toBe('nh');
    const insideMa = { type: 'route', features: [line('a', [[-72, 42.3], [-71.5, 42.4]])] };
    const insideNh = { type: 'route', features: [line('b', [[-71.5, 43.2], [-71.4, 43.6]])] };
    expect(regionForEntry(insideMa, 'ma')).toBeNull();
    expect(regionForEntry(insideNh, 'ma')).toBe('nh');
  });

  it('leaves region and vehicle picks to their own handlers', () => {
    expect(regionForEntry({ type: 'region', key: 'nh' }, 'ma')).toBeNull();
    expect(regionForEntry({ type: 'vehicle' }, 'ma')).toBeNull();
  });
});

describe('airport search', () => {
  const airport = (title: string, faaId: string, icao: string, facilityUse: string, lng: number, lat: number) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: {
      group: 'airport', title, faaId, icao, facilityUse, facilityType: 'Airport',
      status: `${facilityUse === 'public' ? 'Public' : 'Private'} use airport`,
    },
  });

  beforeAll(() => {
    setSearchAirports([
      airport('General Edward Lawrence Logan Intl', 'BOS', 'KBOS', 'public', -71.006, 42.363),
      airport('Laurence G Hanscom Fld', 'BED', 'KBED', 'public', -71.289, 42.47),
      airport('Hidden Acres', '1MA9', '', 'private', -71.5, 42.3),
    ]);
  });

  it('finds public-use airports by FAA id, ICAO id and name', () => {
    for (const query of ['BOS', 'kbos', 'logan']) {
      const hit = find(query).find((entry) => entry.type === 'airport');
      expect(hit?.name).toBe('General Edward Lawrence Logan Intl');
    }
    expect(find('BOS')[0].sub).toBe('BOS / KBOS · Public use airport');
    expect(find('bed').find((entry) => entry.type === 'airport')?.name).toBe('Laurence G Hanscom Fld');
  });

  it('leaves private-use facilities out of search', () => {
    expect(find('hidden acres').some((entry) => entry.type === 'airport')).toBe(false);
    expect(find('1ma9').some((entry) => entry.type === 'airport')).toBe(false);
  });

  it('switches region like any other point result', () => {
    const logan = find('bos').find((entry) => entry.type === 'airport');
    expect(regionForEntry(logan, 'nh')).not.toBeNull();
    expect(regionForEntry(logan, 'ma')).toBeNull();
  });
});
