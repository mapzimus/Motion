import { describe, it, expect, beforeEach } from 'vitest';
import {
  routeKeyIndex,
  setRouteKeyIndex,
  paletteAssignment,
  colorFor,
  routeCountFor,
  setLiveKeyCounts,
  legendSections,
  setLegendZoom,
  setViewportRoutes,
} from './legend.js';
import { setVisibleGroupList } from './layers.js';
import { PALETTE, PALETTE_START } from '../model/palette.js';

const entry = (routes: number) => ({ label: 'x', routes, stops: 0 });

describe('legend store', () => {
  beforeEach(() => {
    setRouteKeyIndex(new Map());
    setLiveKeyCounts(new Map());
  });

  it('ranks operators by route count into palette colors', () => {
    setRouteKeyIndex(new Map([['bus', new Map([['small', entry(2)], ['big', entry(30)]])]]));
    const bus = paletteAssignment.value.get('bus')!;
    expect(bus.get('big')).toBe(PALETTE[0]);
    expect(bus.get('small')).toBe(PALETTE[1]);
  });

  it('recomputes when the index changes', () => {
    setRouteKeyIndex(new Map([['bus', new Map([['a', entry(5)]])]]));
    expect(paletteAssignment.value.get('bus')!.get('a')).toBe(PALETTE[0]);
    setRouteKeyIndex(new Map([['bus', new Map([['a', entry(5)], ['b', entry(9)]])]]));
    expect(paletteAssignment.value.get('bus')!.get('a')).toBe(PALETTE[1]);
  });

  it('ignores groups outside the palette groups', () => {
    setRouteKeyIndex(new Map([['amtrak', new Map([['amtrak', entry(3)]])]]));
    expect(paletteAssignment.value.has('amtrak')).toBe(false);
  });

  it('colorFor uses the fallback outside palette groups', () => {
    expect(colorFor('amtrak', 'amtrak', '#123456')).toBe('#123456');
  });

  it('colorFor lets an official color beat the palette', () => {
    setRouteKeyIndex(new Map([['commuter', new Map([['metro-north', entry(1)]])]]));
    expect(colorFor('commuter', 'metro-north', '#000000')).toBe('#ee0034');
  });

  it('colorFor reads the current assignment', () => {
    setRouteKeyIndex(new Map([['ferry', new Map([['f', entry(1)]])]]));
    expect(colorFor('ferry', 'f', '#000000')).toBe(PALETTE[PALETTE_START.ferry]);
  });

  it('live counts never change colors', () => {
    setRouteKeyIndex(new Map([['bus', new Map([['a', entry(5)], ['b', entry(1)]])]]));
    const before = colorFor('bus', 'b', '#000');
    setLiveKeyCounts(new Map([['bus', new Map([['b', { n: 500 }]])]]));
    expect(colorFor('bus', 'b', '#000')).toBe(before);
  });

  it('routeCountFor returns the indexed count or 0', () => {
    setRouteKeyIndex(new Map([['bus', new Map([['a', entry(7)]])]]));
    expect(routeCountFor('bus', 'a')).toBe(7);
    expect(routeCountFor('bus', 'zzz')).toBe(0);
    expect(routeKeyIndex.value.size).toBe(1);
  });

  it('builds sections for the groups switched on and follows the zoom mode', () => {
    setRouteKeyIndex(new Map([['bus', new Map([['mbta', { label: 'MBTA', routes: 150, stops: 0 }]])]]));
    setViewportRoutes(new Map([['bus', new Map([
      ['1', { label: '1', color: '#aaaaaa', operatorKey: 'mbta', operatorLabel: 'MBTA', live: false }],
    ])]]));
    setVisibleGroupList(['ferry', 'bus']);
    setLegendZoom(12);
    expect(legendSections.value.map((s) => s.group)).toEqual(['bus', 'ferry']);
    expect(legendSections.value[0].rows[0].label).toBe('MBTA');
    setLegendZoom(14);
    expect(legendSections.value[0].operators![0].rows[0].label).toBe('1');
    setVisibleGroupList(['ferry']);
    expect(legendSections.value.map((s) => s.group)).toEqual(['ferry']);
  });
});
