// Pure builders behind the map key: operator rows from the route index and
// live counts, viewport route rows from rendered map features, and the
// per-group sections the Legend component draws. No map, DOM or store access.
import { BIKE_STATE_ROWS, BIKE_SYSTEMS, LEGEND_GROUPS, STALE_NOTE, type LegendGlyph } from './legendConfig.js';
import { paletteColorFor } from './palette.js';
import { GROUP_KEYS, SUBWAY_GROUPS } from './presets.js';
import type { LiveKeyCounts, LiveKeyEntry, RouteKeyEntry, RouteKeyIndex } from '../stores/legend.js';

/** Rows shown per section (and per operator when zoomed in) before "+N more". */
export const LEGEND_ROW_CAP = 12;
/** At or above this zoom, route groups list the routes in view instead of operators. */
export const VIEWPORT_ZOOM = 13.5;
/** Groups drawn as route ribbons, which switch to viewport routes when zoomed in. */
export const VIEWPORT_GROUPS: readonly string[] = ['commuter', 'bus', 'amtrak', 'ferry', 'air-service'];

const FALLBACK_COLOR = '#8a939c';

export interface LegendRowView {
  key: string;
  label: string;
  color: string;
  /** Live vehicles for this operator in the region. */
  live?: number;
  routes?: number;
  stops?: number;
  /** Viewport route rows: a live vehicle on this route is in view. */
  moving?: boolean;
}

export interface OperatorBlock {
  key: string;
  label: string;
  color: string;
  rows: LegendRowView[];
  more: number;
  extra: LegendRowView[];
}

export interface LegendSection {
  group: string;
  name: string;
  glyph: LegendGlyph;
  rows: LegendRowView[];
  /** Rows past the cap: `more` is their count, `extra` the rows themselves. */
  more: number;
  extra: LegendRowView[];
  /** Zoomed in: routes in view grouped under their operator ([] = none in view). */
  operators?: OperatorBlock[];
  notes: string[];
}

export interface LegendOptions {
  /** False where the region has no subway: the Subway section is left out. Default true. */
  hasSubway?: boolean;
}

export interface ViewportRoute {
  label: string;
  color: string;
  operatorKey: string;
  operatorLabel: string;
  live: boolean;
}
/** group -> route key -> route in view. */
export type ViewportRoutes = Map<string, Map<string, ViewportRoute>>;

export interface LegendInputs {
  /** Groups switched on (any order). */
  groups: readonly string[];
  zoom: number;
  index: RouteKeyIndex;
  live: LiveKeyCounts;
  assignment: Map<string, Map<string, string>>;
  viewport: ViewportRoutes;
  subwayColors: Map<string, string>;
  /** Extra note lines for a group, such as live vessel source credits. */
  notesByGroup?: Readonly<Record<string, readonly string[]>>;
}

type Props = Record<string, any>;
interface FeatureLike { properties: Props | null }

interface CappedRows { rows: LegendRowView[]; more: number; extra: LegendRowView[] }

/** The first `cap` rows, plus the rest for the "+N more" expander. */
function capRows(rows: LegendRowView[], cap: number): CappedRows {
  const extra = rows.slice(cap);
  return { rows: rows.slice(0, cap), more: extra.length, extra };
}

/** Sort keys by palette rank, then static route count, then live count, then label. */
function rankOperators(
  keys: Iterable<string>,
  assignment: Map<string, string> | undefined,
  index: Map<string, RouteKeyEntry> | undefined,
  live: Map<string, LiveKeyEntry> | undefined,
  labelOf: (key: string) => string,
): string[] {
  const rank = new Map([...(assignment?.keys() ?? [])].map((key, i) => [key, i]));
  return [...keys].sort((a, b) =>
    (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) ||
    (index?.get(b)?.routes ?? 0) - (index?.get(a)?.routes ?? 0) ||
    (live?.get(b)?.n ?? 0) - (live?.get(a)?.n ?? 0) ||
    labelOf(a).localeCompare(labelOf(b)));
}

/** One row per operator known from the route index or seen live, capped. */
export function operatorRows(
  group: string,
  index: Map<string, RouteKeyEntry> | undefined,
  live: Map<string, LiveKeyEntry> | undefined,
  assignment: Map<string, string> | undefined,
  cap = LEGEND_ROW_CAP,
): CappedRows {
  const labelOf = (key: string) => index?.get(key)?.label ?? live?.get(key)?.label ?? key;
  const keys = new Set([...(index?.keys() ?? []), ...(live?.keys() ?? [])]);
  const groupAssignment = new Map([[group, assignment ?? new Map<string, string>()]]);
  const rows = rankOperators(keys, assignment, index, live, labelOf).map((key) => {
    const row: LegendRowView = {
      key,
      label: labelOf(key),
      color: paletteColorFor(group, key, groupAssignment, live?.get(key)?.color ?? FALLBACK_COLOR),
    };
    const n = live?.get(key)?.n;
    if (n) row.live = n;
    const e = index?.get(key);
    if (e?.routes) row.routes = e.routes;
    if (e?.stops) row.stops = e.stops;
    return row;
  });
  return capRows(rows, cap);
}

/**
 * One row per bikeshare system seen live in the region, in its own map color
 * and catalog order, then the low and empty dock rows whose colors override it.
 */
export function bikeRows(live: Map<string, LiveKeyEntry> | undefined): LegendRowView[] {
  const known = new Map(BIKE_SYSTEMS.map((system, i) => [system.key, { ...system, rank: i }]));
  const systems = [...(live ?? new Map<string, LiveKeyEntry>())]
    .map(([key, e]) => {
      const system = known.get(key);
      const row: LegendRowView = {
        key,
        label: system?.label ?? e.label ?? key,
        color: system?.color ?? e.color ?? FALLBACK_COLOR,
      };
      if (e.n) row.live = e.n;
      return { row, rank: system?.rank ?? Infinity };
    })
    .sort((a, b) => a.rank - b.rank || a.row.label.localeCompare(b.row.label))
    .map(({ row }) => row);
  return [...systems, ...BIKE_STATE_ROWS];
}

/** Live vehicles per group and operator key across region-filtered fleets. */
export function countLiveKeys(collections: Iterable<{ features: FeatureLike[] }>): LiveKeyCounts {
  const out: LiveKeyCounts = new Map();
  for (const collection of collections) {
    for (const { properties: p } of collection.features) {
      if (!p?.group || !p.legendKey) continue;
      if (!out.has(p.group)) out.set(p.group, new Map());
      const keys = out.get(p.group)!;
      const e = keys.get(p.legendKey);
      if (e) e.n += 1;
      else {
        const entry: LiveKeyEntry = { n: 1 };
        if (p.legendLabel) entry.label = p.legendLabel;
        if (p.color) entry.color = p.color;
        keys.set(p.legendKey, entry);
      }
    }
  }
  return out;
}

const shortRouteId = (id: string) => id.split(':').pop() ?? id;

/**
 * Distinct routes among rendered map features: static route lines carry
 * `route`, live vehicles carry the matching `shadeKey`. A static route's name
 * wins over a vehicle title; any vehicle on the route marks it live.
 */
export function viewportRoutesFromFeatures(features: Iterable<FeatureLike>): ViewportRoutes {
  const out: ViewportRoutes = new Map();
  const named = new Set<string>();
  for (const { properties: p } of features) {
    if (!p?.group || !p.legendKey) continue;
    const isVehicle = !p.route;
    const routeKey = isVehicle ? p.shadeKey : p.route;
    if (!routeKey) continue;
    if (!out.has(p.group)) out.set(p.group, new Map());
    const routes = out.get(p.group)!;
    const id = `${p.group}\u0000${routeKey}`;
    let route = routes.get(routeKey);
    if (!route) {
      route = {
        label: '',
        color: p.routeColor ?? p.color ?? FALLBACK_COLOR,
        operatorKey: p.legendKey,
        operatorLabel: p.legendKey === 'mbta' ? 'MBTA' : (p.legendLabel ?? p.agency ?? p.legendKey),
        live: false,
      };
      routes.set(routeKey, route);
    }
    if (isVehicle) {
      route.live = true;
      if (!route.label) route.label = p.title || shortRouteId(String(routeKey));
    } else if (!named.has(id)) {
      named.add(id);
      route.label = p.name || shortRouteId(String(routeKey));
    }
  }
  return out;
}

/** Viewport routes grouped under their operators, operators in palette order. */
function viewportOperators(
  group: string,
  routes: Map<string, ViewportRoute>,
  inputs: LegendInputs,
): OperatorBlock[] {
  const byOperator = new Map<string, Array<[string, ViewportRoute]>>();
  for (const [routeKey, route] of routes) {
    if (!byOperator.has(route.operatorKey)) byOperator.set(route.operatorKey, []);
    byOperator.get(route.operatorKey)!.push([routeKey, route]);
  }
  const index = inputs.index.get(group);
  const labelOf = (key: string) => index?.get(key)?.label ?? byOperator.get(key)![0][1].operatorLabel;
  const keys = rankOperators(byOperator.keys(), inputs.assignment.get(group), index, inputs.live.get(group), labelOf);
  return keys.map((key) => {
    const list = byOperator.get(key)!;
    const rows = list
      .map(([routeKey, route]) => {
        const row: LegendRowView = { key: routeKey, label: route.label, color: route.color };
        if (route.live) row.moving = true;
        return row;
      })
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    return {
      key,
      label: labelOf(key),
      color: paletteColorFor(group, key, inputs.assignment, list[0][1].color),
      ...capRows(rows, LEGEND_ROW_CAP),
    };
  });
}

/** The subway lines that are on, as rows of one "Subway" section; null when none are on. */
function subwaySection(on: Set<string>, inputs: LegendInputs): LegendSection | null {
  const rows = SUBWAY_GROUPS.filter((group: string) => on.has(group)).map((group: string) => {
    const row: LegendRowView = {
      key: group,
      label: LEGEND_GROUPS[group].name,
      color: inputs.subwayColors.get(group) ?? FALLBACK_COLOR,
    };
    let n = 0;
    for (const e of inputs.live.get(group)?.values() ?? []) n += e.n;
    if (n) row.live = n;
    return row;
  });
  if (!rows.length) return null;
  return { group: 'subway', name: 'Subway', glyph: 'rail', rows, more: 0, extra: [], notes: [] };
}

/** Footer lines: the stale-position note, once, when any group that fades is on. */
export function legendFooter(groups: readonly string[]): string[] {
  return groups.some((group) => LEGEND_GROUPS[group]?.fades) ? [STALE_NOTE] : [];
}

/** True when two group -> key -> flat record maps hold the same contents. */
export function sameNestedMap<T extends object>(
  a: Map<string, Map<string, T>>,
  b: Map<string, Map<string, T>>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [group, inner] of a) {
    const other = b.get(group);
    if (!other || other.size !== inner.size) return false;
    for (const [key, value] of inner) {
      const twin = other.get(key) as Record<string, unknown> | undefined;
      if (!twin) return false;
      const entries = Object.entries(value);
      if (entries.length !== Object.keys(twin).length) return false;
      if (entries.some(([k, v]) => twin[k] !== v)) return false;
    }
  }
  return true;
}

/**
 * One section per switched-on group, in panel (GROUP_KEYS) order. The subway
 * lines share one "Subway" section, placed where the first line would be, and
 * left out where the region has no subway.
 */
export function buildLegendSections(inputs: LegendInputs, { hasSubway = true }: LegendOptions = {}): LegendSection[] {
  const on = new Set(inputs.groups);
  const zoomedIn = inputs.zoom >= VIEWPORT_ZOOM;
  const subway = hasSubway ? subwaySection(on, inputs) : null;
  const rest = GROUP_KEYS.filter((group: string) =>
    on.has(group) && LEGEND_GROUPS[group] && !SUBWAY_GROUPS.includes(group)).map((group: string) => {
    const config = LEGEND_GROUPS[group];
    const section: LegendSection = {
      group,
      name: config.name,
      glyph: config.glyph,
      rows: [],
      more: 0,
      extra: [],
      notes: [...config.notes, ...(inputs.notesByGroup?.[group] ?? [])],
    };
    if (group === 'bike') {
      section.rows = bikeRows(inputs.live.get(group));
    } else if (config.fixedRows) {
      section.rows = config.fixedRows;
    } else if (zoomedIn && VIEWPORT_GROUPS.includes(group)) {
      section.operators = viewportOperators(group, inputs.viewport.get(group) ?? new Map(), inputs);
    } else {
      Object.assign(section, operatorRows(
        group,
        inputs.index.get(group),
        inputs.live.get(group),
        inputs.assignment.get(group),
      ));
    }
    return section;
  });
  return subway ? [subway, ...rest] : rest;
}

/** One section for the layer currently drilled into, with a row per route. */
export function drillLegendSection(
  group: string,
  rows: LegendRowView[],
  operatorLabel?: string | null,
): LegendSection | null {
  const config = LEGEND_GROUPS[group];
  if (!config) return null;
  return {
    group,
    name: operatorLabel || config.name,
    glyph: config.glyph,
    ...capRows(rows, LEGEND_ROW_CAP),
    notes: operatorLabel ? [config.name] : [],
  };
}
