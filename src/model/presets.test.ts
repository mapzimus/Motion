import { describe, expect, it } from 'vitest';
import {
  GROUP_KEYS,
  ROUTE_GROUPS,
  SCENES,
  SUBWAY_GROUPS,
  VEHICLE_PRESETS,
  resolvePreset,
} from './presets.js';
import { LEGEND_GROUPS } from './legendConfig.js';

const group = (key: string, extra: Record<string, unknown> = {}) => ({ key, ...extra });
const allGroups = GROUP_KEYS.map((key) =>
  group(key, { truth: ['bus', 'commuter', 'amtrak', 'ferry', 'plane', 'vessel', 'bike'].includes(key) ? 'live' : undefined }));
const subwayRegion = (region: string) => region === 'greater-boston';

describe('presets reference real layer groups', () => {
  it('lists only known group keys', () => {
    const known = new Set(GROUP_KEYS);
    for (const preset of VEHICLE_PRESETS) {
      if (preset.groups === 'live') continue;
      for (const key of preset.groups) expect(known.has(key), `${preset.key} → ${key}`).toBe(true);
    }
    for (const scene of SCENES) {
      for (const key of scene.groups) expect(known.has(key), `${scene.key} → ${key}`).toBe(true);
    }
    for (const key of ROUTE_GROUPS) expect(known.has(key)).toBe(true);
  });
});

describe('resolvePreset', () => {
  it('"All live" keeps the subway where the region has one', () => {
    const plan = resolvePreset('all-live', { region: 'greater-boston', groups: allGroups, hasSubway: subwayRegion });
    for (const key of SUBWAY_GROUPS) expect(plan?.groups).toContain(key);
    expect(plan?.groups).toContain('bus');
  });

  it('"All live" drops the subway elsewhere', () => {
    const plan = resolvePreset('all-live', { region: 'ct', groups: allGroups, hasSubway: subwayRegion });
    for (const key of SUBWAY_GROUPS) expect(plan?.groups).not.toContain(key);
  });

  it('Boston commute leaves scheduled routes and stops visible', () => {
    const plan = resolvePreset('boston-commute', { region: 'ct', groups: allGroups, hasSubway: subwayRegion });
    expect(plan?.region).toBe('greater-boston');
    expect(plan?.statuses).toContain('scheduled');
    for (const key of SUBWAY_GROUPS) expect(plan?.groups).toContain(key);
  });

  it('resolves to no groups when every group needs the gateway', () => {
    const gated = allGroups.map((g) =>
      (['traffic', 'incident', 'roadwork', 'camera', 'road-weather', 'message-sign', 'weather'].includes(g.key) ? { ...g, needsKey: true } : g));
    const plan = resolvePreset('roads', { region: 'ma', groups: gated, hasSubway: subwayRegion });
    // Plow routes are a static file, so the Roads preset still has them.
    expect(plan?.groups).toEqual(['plow']);
  });
});

describe('park & ride stays a reference layer', () => {
  it('does not turn on with the Buses or Roads show filters', () => {
    const buses = resolvePreset('buses', { region: 'ma', groups: allGroups, hasSubway: subwayRegion });
    expect(buses?.groups).toEqual(['bus', 'local', 'taxi']);
    expect(buses?.groups).not.toContain('park-ride');
    const roads = resolvePreset('roads', { region: 'ma', groups: allGroups, hasSubway: subwayRegion });
    expect(roads?.groups).not.toContain('park-ride');
    expect(GROUP_KEYS).toContain('park-ride');
  });
});

describe('preset additions', () => {
  it('Disruptions resolves to the alert layers and nothing else', () => {
    const plan = resolvePreset('disruptions', { region: 'ma', groups: allGroups, hasSubway: subwayRegion });
    expect(plan?.groups?.sort()).toEqual(['airport-status', 'incident', 'roadwork', 'tfr', 'weather']);
    expect(plan?.region).toBeNull();
  });

  it('Disruptions is empty without the gateway', () => {
    const gated = allGroups.map((g) =>
      (['incident', 'roadwork', 'weather', 'airport-status', 'tfr'].includes(g.key) ? { ...g, needsKey: true } : g));
    expect(resolvePreset('disruptions', { region: 'ma', groups: gated })?.groups).toEqual([]);
  });

  it.each([
    ['providence', 'providence-metro'],
    ['casco-bay', 'southern-maine'],
    ['ct-shoreline', 'new-haven-shoreline'],
  ])('scene %s switches to %s with every status shown', (key, region) => {
    const plan = resolvePreset(key, { region: 'greater-boston', groups: allGroups, hasSubway: subwayRegion });
    expect(plan?.region).toBe(region);
    expect(plan?.statuses).toEqual(['live', 'estimated', 'scheduled', 'reference']);
    for (const subway of SUBWAY_GROUPS) expect(plan?.groups).not.toContain(subway);
  });
});

describe('legend descriptors', () => {
  it('every GROUP_KEYS entry has a LEGEND_GROUPS descriptor and vice versa', () => {
    expect(Object.keys(LEGEND_GROUPS).sort()).toEqual([...GROUP_KEYS].sort());
    for (const key of GROUP_KEYS) {
      expect(LEGEND_GROUPS[key].name, key).toBeTruthy();
      expect(Array.isArray(LEGEND_GROUPS[key].notes), key).toBe(true);
    }
  });
  it('every fixedRows entry has a 6-digit hex color', () => {
    for (const [key, g] of Object.entries(LEGEND_GROUPS)) {
      for (const row of g.fixedRows ?? []) expect(row.color, `${key}/${row.key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
