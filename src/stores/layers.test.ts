// Unit tests for B1 stores: layer presets in CT, count totals.
import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@preact/signals';
import {
  groupOn,
  manualOverrides,
  statuses,
  visibleGroups,
  visibleStatuses,
  setGroupOn,
  setStatus,
  setVisibleGroupList,
  setVisibleStatusList,
  initGroupState,
  clearManualOverrides,
} from './layers.js';
import {
  countsBySource,
  scheduledCounts,
  stationCounts,
  referenceCounts,
  updateCounts,
  replaceCounts,
  setScheduledCounts,
  setStationCounts,
  setReferenceCounts,
  liveCountForGroup,
} from './counts.js';
import { resolvePreset, GROUP_KEYS, SUBWAY_GROUPS } from '../model/presets.js';

describe('layers store', () => {
  beforeEach(() => {
    groupOn.value = new Map();
    manualOverrides.value = new Set();
    statuses.value = new Map([
      ['live', true],
      ['estimated', true],
      ['scheduled', true],
      ['reference', true],
    ]);
  });

  it('tracks visible groups', () => {
    groupOn.value = new Map([
      ['red', true],
      ['bus', false],
      ['ferry', true],
    ]);
    expect(visibleGroups.value).toContain('red');
    expect(visibleGroups.value).toContain('ferry');
    expect(visibleGroups.value).not.toContain('bus');
  });

  it('tracks visible statuses', () => {
    setStatus('reference', false);
    expect(visibleStatuses.value).not.toContain('reference');
    expect(visibleStatuses.value).toContain('live');
  });

  it('marks manual overrides', () => {
    setGroupOn('bus', true, true);
    expect(manualOverrides.value.has('bus')).toBe(true);
    expect(groupOn.value.get('bus')).toBe(true);
  });

  it('replaces group state from a visible list, over every group key', () => {
    setVisibleGroupList(['bus', 'red']);
    expect(visibleGroups.value).toEqual(['red', 'bus']);
    expect(groupOn.value.get('ferry')).toBe(false);
    expect(groupOn.value.size).toBe(GROUP_KEYS.length);
    setVisibleGroupList(['ferry']);
    expect(visibleGroups.value).toEqual(['ferry']);
  });

  it('replaces statuses from a visible list', () => {
    setVisibleStatusList(['live']);
    expect(visibleStatuses.value).toEqual(['live']);
    expect(statuses.value.get('reference')).toBe(false);
  });

  it('clears manual overrides', () => {
    setGroupOn('bus', true, true);
    clearManualOverrides();
    expect(manualOverrides.value.size).toBe(0);
  });
});

describe('applyPreset("routes") in CT (no subway)', () => {
  const groups: any[] = GROUP_KEYS.map((key: string) => ({
    key,
    needsKey: false,
    truth: key === 'plane' ? 'live' : undefined,
  }));

  it('returns only route groups, no subway', () => {
    const plan = (resolvePreset as any)('routes', {
      region: 'ct',
      groups,
      hasSubway: () => false,
    });
    expect(plan).not.toBeNull();
    expect(plan!.mode).toBe('exact');
    for (const key of SUBWAY_GROUPS) {
      expect(plan!.groups).not.toContain(key);
    }
    expect(plan!.groups).toContain('commuter');
    expect(plan!.groups).toContain('bus');
    expect(plan!.groups).toContain('amtrak');
    expect(plan!.groups).toContain('ferry');
  });

  it('strips reference status', () => {
    const plan = (resolvePreset as any)('routes', {
      region: 'ct',
      groups,
      hasSubway: () => false,
    });
    expect(plan!.statuses).not.toContain('reference');
    expect(plan!.statuses).toContain('live');
    expect(plan!.statuses).toContain('scheduled');
  });
});

describe('counts store totals', () => {
  beforeEach(() => {
    countsBySource.value = new Map();
    scheduledCounts.value = new Map();
    stationCounts.value = new Map();
    referenceCounts.value = new Map();
  });

  it('aggregates live counts across sources', () => {
    updateCounts({ red: 5, bus: 20 }, 'mbta');
    updateCounts({ amtrak: 3 }, 'amtrak');
    expect(liveCountForGroup('red')).toBe(5);
    expect(liveCountForGroup('bus')).toBe(20);
    expect(liveCountForGroup('amtrak')).toBe(3);
    expect(liveCountForGroup('ferry')).toBeNull();
  });

  it('replaces source counts', () => {
    updateCounts({ red: 5 }, 'mbta');
    replaceCounts({ red: 10 }, 'mbta');
    expect(liveCountForGroup('red')).toBe(10);
  });

  it('sums across multiple sources for same group', () => {
    updateCounts({ ferry: 3 }, 'mbta');
    updateCounts({ ferry: 2 }, 'regional');
    expect(liveCountForGroup('ferry')).toBe(5);
  });

  it('tracks scheduled and station counts', () => {
    setScheduledCounts({ commuter: 12, bus: 150 });
    setStationCounts({ commuter: 45 });
    expect(scheduledCounts.value.get('commuter')).toBe(12);
    expect(stationCounts.value.get('commuter')).toBe(45);
  });
});
