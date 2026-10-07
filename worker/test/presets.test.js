import { describe, expect, it } from 'vitest';
import {
  ALL_STATUSES,
  GROUP_KEYS,
  ROUTE_GROUPS,
  SCENES,
  SUBWAY_GROUPS,
  VEHICLE_PRESETS,
  presetByKey,
  resolvePreset,
} from '../../src/model/presets.js';
import regionConfig from '../../scripts/regions-config.json';
import uiSource from '../../src/ui.js?raw';

// Mirrors the truth tags and needsKey flags js/ui.js buildGroups() sets when
// every gateway provider is available.
const LIVE_GROUPS = new Set([
  'commuter', 'bus', 'amtrak', 'ferry', 'plane', 'vessel', 'bike',
  'traffic', 'roadwork', 'incident', 'camera', 'road-weather', 'message-sign', 'plow', 'weather', 'airport-status',
  'airport-weather', 'tfr',
]);
const groups = GROUP_KEYS.map((key) => ({
  key,
  truth: LIVE_GROUPS.has(key) ? 'live' : 'reference',
}));
const regionKeys = new Set(regionConfig.regions.map((region) => region.key));
const subwayRegions = new Set(
  regionConfig.regions.filter((region) => region.hasSubway).map((region) => region.key),
);
const hasSubway = (key) => subwayRegions.has(key);

describe('layer presets and scenes', () => {
  it('lists 40 unique layer groups', () => {
    expect(GROUP_KEYS).toHaveLength(40);
    expect(new Set(GROUP_KEYS).size).toBe(40);
  });

  it('puts the aviation conditions in the Air preset', () => {
    const plan = resolvePreset('air', { region: 'ma', groups, hasSubway });
    for (const key of ['airport-status', 'airport-weather', 'tfr', 'airspace']) expect(plan.groups).toContain(key);
  });

  it('matches the groups js/ui.js builds, in panel order', () => {
    const built = [...uiSource.matchAll(/\{ key: '([a-z-]+)', name: /g)].map((match) => match[1]);
    expect(built).toEqual(GROUP_KEYS);
  });

  it('only uses real group keys', () => {
    for (const preset of [...VEHICLE_PRESETS, ...SCENES]) {
      if (preset.groups === 'live') continue;
      for (const key of preset.groups) expect(GROUP_KEYS, `${preset.key}: ${key}`).toContain(key);
    }
    for (const key of ROUTE_GROUPS) expect(GROUP_KEYS).toContain(key);
  });

  it('has unique preset keys that do not shadow Default/Routes/Clear', () => {
    const keys = [...VEHICLE_PRESETS, ...SCENES].map((preset) => preset.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const reserved of ['default', 'routes', 'clear']) expect(keys).not.toContain(reserved);
  });

  it('points every scene at a configured region', () => {
    for (const scene of SCENES) {
      expect(regionKeys.has(scene.region), `${scene.key}: ${scene.region}`).toBe(true);
      for (const status of scene.statuses ?? []) expect(ALL_STATUSES).toContain(status);
    }
  });

  it('marks exactly the regions with MBTA subway stations as having a subway', () => {
    // North Shore reaches the Blue Line at Wonderland, Revere Beach and Beachmont.
    expect([...subwayRegions].sort()).toEqual(['boston', 'greater-boston', 'ma', 'new-england', 'north-shore']);
  });
});

describe('resolvePreset', () => {
  it('Routes in Connecticut: scheduled ribbons, no subway, reference hidden', () => {
    const plan = resolvePreset('routes', { region: 'ct', groups, hasSubway });
    expect(plan.mode).toBe('exact');
    expect(plan.region).toBeNull();
    expect([...plan.groups].sort()).toEqual(['amtrak', 'bus', 'commuter', 'ferry']);
    expect(plan.statuses).toEqual(['live', 'estimated', 'scheduled']);
  });

  it('Routes in Greater Boston adds the subway lines', () => {
    const plan = resolvePreset('routes', { region: 'greater-boston', groups, hasSubway });
    for (const key of SUBWAY_GROUPS) expect(plan.groups).toContain(key);
  });

  it('Default restores region defaults and every status; Clear empties the map', () => {
    expect(resolvePreset('default', { region: 'ct', groups, hasSubway })).toMatchObject({
      mode: 'default', groups: null, statuses: ALL_STATUSES,
    });
    expect(resolvePreset('clear', { region: 'ct', groups, hasSubway })).toMatchObject({
      mode: 'exact', groups: [], statuses: null,
    });
  });

  it('skips groups that need a missing gateway key', () => {
    const withoutAis = groups.map((group) => (group.key === 'vessel' ? { ...group, needsKey: true } : group));
    expect(resolvePreset('water', { region: 'ma', groups: withoutAis, hasSubway }).groups).toEqual(['ferry']);
  });

  it('drops subway lines from Rail outside subway regions', () => {
    expect(resolvePreset('rail', { region: 'ct', groups, hasSubway }).groups).toEqual(['commuter', 'amtrak']);
    expect(resolvePreset('rail', { region: 'boston', groups, hasSubway }).groups).toEqual([
      ...SUBWAY_GROUPS, 'commuter', 'amtrak',
    ]);
  });

  it('All live selects every live-tagged group plus the subway where there is one', () => {
    const plan = resolvePreset('all-live', { region: 'new-england', groups, hasSubway });
    expect(new Set(plan.groups)).toEqual(new Set([...SUBWAY_GROUPS, ...LIVE_GROUPS]));
    const outside = resolvePreset('all-live', { region: 'ct', groups, hasSubway });
    expect(new Set(outside.groups)).toEqual(LIVE_GROUPS);
  });

  it('scenes switch region and layers together', () => {
    const plan = resolvePreset('islands', { region: 'greater-boston', groups, hasSubway });
    expect(plan).toEqual({
      mode: 'exact',
      region: 'cape-islands',
      groups: ['ferry', 'vessel', 'air-service'],
      statuses: ALL_STATUSES,
    });
    expect(resolvePreset('water', { region: 'ma', groups, hasSubway }).statuses).toBeNull();
    const commute = resolvePreset('boston-commute', { region: 'ct', groups, hasSubway });
    expect(commute.region).toBe('greater-boston');
    expect(commute.groups).toEqual([...SUBWAY_GROUPS, 'commuter', 'bus', 'ferry']);
    // Route lines and stops are tagged scheduled; a commute view must keep them.
    expect(commute.statuses).toEqual(ALL_STATUSES);
  });

  it('returns null for an unknown preset', () => {
    expect(resolvePreset('nope', { region: 'ma', groups, hasSubway })).toBeNull();
    expect(presetByKey('nope')).toBeNull();
  });
});
