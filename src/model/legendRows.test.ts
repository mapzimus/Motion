import { describe, it, expect } from 'vitest';
import {
  LEGEND_ROW_CAP,
  VIEWPORT_ZOOM,
  bikeRows,
  buildLegendSections,
  countLiveKeys,
  legendFooter,
  sameNestedMap,
  operatorRows,
  viewportRoutesFromFeatures,
  type LegendInputs,
} from './legendRows.js';
import { BIKE_STATE_ROWS, LEGEND_GROUPS, STALE_NOTE } from './legendConfig.js';
import { PALETTE, PALETTE_START, assignPalette } from './palette.js';

const entry = (routes: number, label = 'x') => ({ label, routes, stops: 0 });

function inputs(over: Partial<LegendInputs> = {}): LegendInputs {
  return {
    groups: [],
    zoom: 10,
    index: new Map(),
    live: new Map(),
    assignment: new Map(),
    viewport: new Map(),
    subwayColors: new Map(),
    ...over,
  };
}

describe('operatorRows', () => {
  it('orders by palette rank, colors from the assignment, merges live counts', () => {
    const index = new Map([['small', entry(2, 'Small Co')], ['big', entry(30, 'Big Co')]]);
    const assignment = assignPalette('bus', [...index].map(([key, e]) => ({ key, routes: e.routes, live: 0 })));
    const live = new Map([['small', { n: 4, label: 'ignored' }], ['live-only', { n: 9, label: 'Live Only' }]]);
    const { rows, more } = operatorRows('bus', index, live, assignment);
    expect(rows.map((r) => r.key)).toEqual(['big', 'small', 'live-only']);
    expect(rows[0]).toMatchObject({ label: 'Big Co', color: PALETTE[PALETTE_START.bus], routes: 30 });
    expect(rows[1]).toMatchObject({ label: 'Small Co', live: 4 });
    expect(rows[2]).toMatchObject({ label: 'Live Only', live: 9 });
    expect(more).toBe(0);
  });

  it('labels the MBTA from the route index', () => {
    const index = new Map([['mbta', entry(150, 'MBTA')]]);
    const { rows } = operatorRows('bus', index, new Map([['mbta', { n: 3, label: 'mbta-live' }]]), new Map());
    expect(rows[0].label).toBe('MBTA');
  });

  it('falls back to the live color outside palette groups', () => {
    const live = new Map([['amtrak', { n: 2, label: 'Amtrak', color: '#5b9bd5' }]]);
    const { rows } = operatorRows('amtrak', undefined, live, undefined);
    expect(rows).toEqual([{ key: 'amtrak', label: 'Amtrak', color: '#5b9bd5', live: 2 }]);
  });

  it('caps the rows and reports the rest as more', () => {
    const index = new Map(Array.from({ length: 15 }, (_, i) => [`op${i}`, entry(100 - i)] as const));
    const { rows, more } = operatorRows('bus', new Map(index), undefined, undefined);
    expect(rows).toHaveLength(LEGEND_ROW_CAP);
    expect(more).toBe(3);
  });
});

describe('countLiveKeys', () => {
  it('counts vehicles per group and operator, keeping a label and color', () => {
    const fc = (props: object[]) => ({ features: props.map((properties) => ({ properties })) });
    const counts = countLiveKeys([
      fc([
        { group: 'bus', legendKey: 'mbta', legendLabel: 'MBTA', color: '#f2b84b' },
        { group: 'bus', legendKey: 'mbta', legendLabel: 'MBTA', color: '#f2b84b' },
        { group: 'red', legendKey: 'mbta', legendLabel: 'MBTA', color: '#da291c' },
      ]),
      fc([{ group: 'bus', legendKey: 'cttransit', legendLabel: 'CTtransit' }, { group: 'bus' }]),
    ]);
    expect(counts.get('bus')!.get('mbta')).toEqual({ n: 2, label: 'MBTA', color: '#f2b84b' });
    expect(counts.get('bus')!.get('cttransit')!.n).toBe(1);
    expect(counts.get('red')!.get('mbta')!.n).toBe(1);
    expect(counts.get('bus')!.size).toBe(2);
  });
});

describe('viewportRoutesFromFeatures', () => {
  it('groups distinct routes by layer group with operator and live flags', () => {
    const routes = viewportRoutesFromFeatures([
      { properties: { group: 'bus', legendKey: 'mbta', route: '1', name: '1', routeColor: '#aaaaaa', kind: 'mbta' } },
      { properties: { group: 'bus', legendKey: 'mbta', route: '1', name: '1', routeColor: '#aaaaaa', kind: 'mbta' } },
      { properties: { group: 'bus', legendKey: 'mbta', shadeKey: '1', title: 'Bus 1', legendLabel: 'MBTA', routeColor: '#aaaaaa' } },
      { properties: { group: 'bus', legendKey: 'cttransit', route: 'cttransit:9', name: 'Route 9', agency: 'CTtransit', color: '#123456', kind: 'regional-static' } },
      { properties: { group: 'plane', legendKey: 'all' } },
    ]);
    const bus = routes.get('bus')!;
    expect([...bus.keys()]).toEqual(['1', 'cttransit:9']);
    expect(bus.get('1')).toEqual({ label: '1', color: '#aaaaaa', operatorKey: 'mbta', operatorLabel: 'MBTA', live: true });
    expect(bus.get('cttransit:9')).toMatchObject({ label: 'Route 9', color: '#123456', operatorLabel: 'CTtransit', live: false });
    expect(routes.has('plane')).toBe(false);
  });

  it('prefers the static route name over a vehicle title', () => {
    const routes = viewportRoutesFromFeatures([
      { properties: { group: 'bus', legendKey: 'mbta', shadeKey: '1', title: 'Bus 1', routeColor: '#aaaaaa' } },
      { properties: { group: 'bus', legendKey: 'mbta', route: '1', name: '1', routeColor: '#aaaaaa', kind: 'mbta' } },
    ]);
    expect(routes.get('bus')!.get('1')).toMatchObject({ label: '1', live: true });
  });
});

describe('legend notes', () => {
  it('keeps the stale note out of section notes and shows it once in the footer', () => {
    const groups = ['red', 'bus', 'ferry', 'ev-charging'];
    const sections = buildLegendSections(inputs({ groups }));
    expect(sections.flatMap((s) => s.notes)).toEqual(['Zoomed out, brighter = more chargers; white ring = DC fast']);
    expect(legendFooter(groups)).toEqual([STALE_NOTE]);
  });

  it('has no footer when no fading group is on', () => {
    expect(legendFooter(['ev-charging', 'plane'])).toEqual([]);
  });
});

describe('sameNestedMap', () => {
  it('compares nested maps of flat records by content', () => {
    const a = new Map([['bus', new Map([['mbta', { n: 2, label: 'MBTA' }]])]]);
    expect(sameNestedMap(a, new Map([['bus', new Map([['mbta', { n: 2, label: 'MBTA' }]])]]))).toBe(true);
    expect(sameNestedMap(a, new Map([['bus', new Map([['mbta', { n: 3, label: 'MBTA' }]])]]))).toBe(false);
    expect(sameNestedMap(a, new Map([['bus', new Map([['mbta', { n: 2 }]])]]))).toBe(false);
    expect(sameNestedMap(a, new Map())).toBe(false);
  });
});

describe('buildLegendSections', () => {
  it('builds sections for ON groups only, in GROUP_KEYS order', () => {
    const sections = buildLegendSections(inputs({ groups: ['ferry', 'bus'] }));
    expect(sections.map((s) => s.group)).toEqual(['bus', 'ferry']);
  });

  it('folds the subway lines that are on into one Subway section, with live counts', () => {
    const live = new Map([['red', new Map([['mbta', { n: 12 }]])]]);
    const sections = buildLegendSections(inputs({
      groups: ['bus', 'blue', 'red'],
      live,
      subwayColors: new Map([['red', '#da291c'], ['blue', '#003da5']]),
    }));
    expect(sections.map((s) => s.group)).toEqual(['subway', 'bus']);
    expect(sections[0]).toMatchObject({ name: 'Subway', glyph: 'rail', notes: [] });
    expect(sections[0].rows).toEqual([
      { key: 'red', label: LEGEND_GROUPS.red.name, color: '#da291c', live: 12 },
      { key: 'blue', label: LEGEND_GROUPS.blue.name, color: '#003da5' },
    ]);
  });

  it('leaves the Subway section out when no line is on', () => {
    expect(buildLegendSections(inputs({ groups: ['bus'] })).some((s) => s.group === 'subway')).toBe(false);
  });

  it('uses fixed rows where the config has them', () => {
    const [weather] = buildLegendSections(inputs({ groups: ['weather'] }));
    expect(weather.rows.map((r) => r.key)).toEqual(LEGEND_GROUPS.weather.fixedRows!.map((r) => r.key));
  });

  it('lists live bikeshare systems in their own map colors, then the low and empty dock rows', () => {
    // First-seen colors can be a low/empty dock color; the system color must win.
    const live = new Map([['bike', new Map([
      ['spin-providence', { n: 40, label: 'Spin · Providence', color: '#ff7f32' }],
      ['bluebikes', { n: 400, label: 'Bluebikes · 13 Greater Boston municipalities', color: '#ffb454' }],
    ])]]);
    const [bike] = buildLegendSections(inputs({ groups: ['bike'], live }));
    expect(bike.rows).toEqual([
      { key: 'bluebikes', label: 'Bluebikes · 13 Greater Boston municipalities', color: '#4d9fec', live: 400 },
      { key: 'spin-providence', label: 'Spin · Providence', color: '#ff7f32', live: 40 },
      ...BIKE_STATE_ROWS,
    ]);
    expect(BIKE_STATE_ROWS.map((r) => r.label)).toEqual(['1-2 bikes left', 'Empty dock']);
  });

  it('shows only the dock state rows when no bikeshare system is live', () => {
    expect(bikeRows(undefined)).toEqual(BIKE_STATE_ROWS);
  });

  it('keeps an unknown bikeshare system with its live label and color', () => {
    const rows = bikeRows(new Map([['new-sys', { n: 3, label: 'New system', color: '#123456' }]]));
    expect(rows[0]).toEqual({ key: 'new-sys', label: 'New system', color: '#123456', live: 3 });
  });

  it('leaves the Subway section out where the region has no subway', () => {
    const on = inputs({ groups: ['red', 'bus'] });
    expect(buildLegendSections(on, { hasSubway: false }).map((s) => s.group)).toEqual(['bus']);
    expect(buildLegendSections(on, { hasSubway: true }).map((s) => s.group)).toEqual(['subway', 'bus']);
  });

  it('does not mark catalog-only local services as fading', () => {
    expect(LEGEND_GROUPS.local.fades).toBeFalsy();
    expect(legendFooter(['local'])).toEqual([]);
  });

  it('switches route groups to viewport routes grouped by operator when zoomed in', () => {
    const viewport = new Map([['bus', new Map([
      ['1', { label: '1', color: '#aaaaaa', operatorKey: 'mbta', operatorLabel: 'MBTA', live: true }],
      ['cttransit:9', { label: 'Route 9', color: '#123456', operatorKey: 'cttransit', operatorLabel: 'CTtransit', live: false }],
      ['2', { label: '2', color: '#bbbbbb', operatorKey: 'mbta', operatorLabel: 'MBTA', live: false }],
    ])]]);
    const index = new Map([['bus', new Map([['mbta', entry(150, 'MBTA')], ['cttransit', entry(10, 'CTtransit')]])]]);
    const out = inputs({ groups: ['bus'], index, viewport });
    const [zoomedOut] = buildLegendSections(out);
    expect(zoomedOut.operators).toBeUndefined();
    expect(zoomedOut.rows.map((r) => r.key)).toEqual(['mbta', 'cttransit']);

    const [zoomedIn] = buildLegendSections({ ...out, zoom: VIEWPORT_ZOOM });
    expect(zoomedIn.rows).toEqual([]);
    expect(zoomedIn.operators!.map((o) => o.label)).toEqual(['MBTA', 'CTtransit']);
    expect(zoomedIn.operators![0].rows.map((r) => r.label)).toEqual(['1', '2']);
    expect(zoomedIn.operators![0].rows[0]).toMatchObject({ color: '#aaaaaa', moving: true });
  });

  it('caps viewport routes per operator', () => {
    const many = new Map(Array.from({ length: 14 }, (_, i) => [`r${i}`, {
      label: `R${i}`, color: '#aaaaaa', operatorKey: 'mbta', operatorLabel: 'MBTA', live: false,
    }] as const));
    const [bus] = buildLegendSections(inputs({ groups: ['bus'], zoom: 15, viewport: new Map([['bus', new Map(many)]]) }));
    expect(bus.operators![0].rows).toHaveLength(LEGEND_ROW_CAP);
    expect(bus.operators![0].more).toBe(2);
  });

  it('gives zoomed-in route groups an empty operator list when nothing is in view', () => {
    const [bus] = buildLegendSections(inputs({ groups: ['bus'], zoom: 15 }));
    expect(bus.operators).toEqual([]);
  });

  it('keeps operator rows for non-route groups when zoomed in', () => {
    const live = new Map([['plane', new Map([['all', { n: 40, label: 'Aircraft', color: '#ffffff' }]])]]);
    const [plane] = buildLegendSections(inputs({ groups: ['plane'], zoom: 15, live }));
    expect(plane.operators).toBeUndefined();
    expect(plane.rows[0]).toMatchObject({ label: 'Aircraft', live: 40 });
  });
});
