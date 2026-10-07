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
  liveKeyCounts,
  viewportRoutes,
  wantsViewportRoutes,
  setLegendCollapsed,
  setDrillLegend,
} from './legend.js';
import { setVisibleGroupList } from './layers.js';
import { PALETTE, PALETTE_START } from '../model/palette.js';

const entry = (routes: number) => ({ label: 'x', routes, stops: 0 });

describe('legend store', () => {
  beforeEach(() => {
    setRouteKeyIndex(new Map());
    setLiveKeyCounts(new Map());
    setDrillLegend(null);
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

  it('skips writes that would not change the live counts or viewport routes', () => {
    setLiveKeyCounts(new Map([['bus', new Map([['a', { n: 1 }]])]]));
    const before = liveKeyCounts.value;
    setLiveKeyCounts(new Map([['bus', new Map([['a', { n: 1 }]])]]));
    expect(liveKeyCounts.value).toBe(before);
    setLiveKeyCounts(new Map([['bus', new Map([['a', { n: 2 }]])]]));
    expect(liveKeyCounts.value).not.toBe(before);

    const route = { label: '1', color: '#aaaaaa', operatorKey: 'mbta', operatorLabel: 'MBTA', live: false };
    setViewportRoutes(new Map([['bus', new Map([['1', route]])]]));
    const routes = viewportRoutes.value;
    setViewportRoutes(new Map([['bus', new Map([['1', { ...route }]])]]));
    expect(viewportRoutes.value).toBe(routes);
  });

  it('shows only the drilled layer in the key', () => {
    setVisibleGroupList(['bus', 'ferry']);
    setDrillLegend({
      group: 'green',
      route: 'Green-E',
      operator: null,
      operatorLabel: null,
      vehicles: 3,
      rows: [
        { key: 'Green-E', label: 'Green-E', color: '#e6194b', live: 2 },
        { key: 'Green-D', label: 'Green-D', color: '#3cb44b', live: 1 },
      ],
    });
    expect(legendSections.value.map((section) => section.name)).toEqual(['Green Line']);
    expect(legendSections.value[0].rows.map((row) => row.label)).toEqual(['Green-E', 'Green-D']);
    setDrillLegend(null);
    expect(legendSections.value.map((section) => section.group)).toEqual(['bus', 'ferry']);
  });

  it('keeps a drill route color when the vehicle is painted again', async () => {
    const { assignRouteColors, clearRouteColors } = await import('../model/routePalette.js');
    const { paintVehicle, restoreVehicleColors } = await import('./legend.js');
    try {
      assignRouteColors([
        { properties: { group: 'green', route: 'Green-E', shadeKey: 'Green-E' } },
        { properties: { group: 'green', route: 'Green-D', shadeKey: 'Green-D' } },
      ], 'green');
      const first = paintVehicle({ props: { group: 'green', route: 'Green-E', shadeKey: 'Green-E', color: '#00843D' } });
      expect(first.props.color).not.toBe('#00843D');
      const again = paintVehicle({ props: { group: 'green', route: 'Green-E', shadeKey: 'Green-E', color: '#00843D' } });
      expect(again.props.color).toBe(first.props.color);
      expect(restoreVehicleColors(again.props)?.color).toBe('#00843D');
    } finally {
      clearRouteColors();
    }
  });

  it('wants viewport routes only when open and a route group is on', () => {
    setLegendCollapsed(false);
    setVisibleGroupList(['plane']);
    expect(wantsViewportRoutes()).toBe(false);
    setVisibleGroupList(['bus']);
    expect(wantsViewportRoutes()).toBe(true);
    setLegendCollapsed(true);
    expect(wantsViewportRoutes()).toBe(false);
    setLegendCollapsed(false);
  });
});
