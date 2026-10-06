// Pure helpers behind the static route recoloring: index a region's route
// features by operator, then stamp each with its operator color and shade.
import { PALETTE_GROUPS, paletteColorFor, routeShade } from './palette.js';
import type { RouteKeyIndex } from '../stores/legend.js';

interface Props { [k: string]: any }
interface FeatureLike { properties: Props }

const isStation = (p: Props) => p.kind === 'regional-station';
const eligible = (p: Props) => PALETTE_GROUPS.includes(p.group) && !!p.legendKey;

/** group -> key -> label, distinct route count and station count, palette groups only. */
export function buildRouteKeyIndex(features: FeatureLike[]): RouteKeyIndex {
  const raw = new Map<string, Map<string, { agencies: Map<string, number>; routeIds: Set<string>; stops: number }>>();
  for (const { properties: p } of features) {
    if (!eligible(p)) continue;
    if (!raw.has(p.group)) raw.set(p.group, new Map());
    const keys = raw.get(p.group)!;
    if (!keys.has(p.legendKey)) keys.set(p.legendKey, { agencies: new Map(), routeIds: new Set(), stops: 0 });
    const e = keys.get(p.legendKey)!;
    if (isStation(p)) e.stops += 1;
    else {
      e.routeIds.add(p.route);
      if (p.agency) e.agencies.set(p.agency, (e.agencies.get(p.agency) ?? 0) + 1);
    }
  }
  const out: RouteKeyIndex = new Map();
  for (const [group, keys] of raw) {
    const m = new Map();
    for (const [key, e] of keys) {
      const top = [...e.agencies].sort((a, b) => b[1] - a[1])[0];
      m.set(key, { label: key === 'mbta' ? 'MBTA' : (top?.[0] ?? key), routes: e.routeIds.size, stops: e.stops });
    }
    out.set(group, m);
  }
  return out;
}

/**
 * Set opColor (operator color, official brand color first) and routeColor (its
 * per-route shade) on palette-group features; clear both on every other one so
 * nothing stale survives a region change.
 */
export function stampRouteColors(
  features: FeatureLike[],
  assignment: Map<string, Map<string, string>>,
  index: RouteKeyIndex,
): void {
  for (const { properties: p } of features) {
    if (!eligible(p)) { delete p.opColor; delete p.routeColor; continue; }
    const opColor = paletteColorFor(p.group, p.legendKey, assignment, p.color);
    const routeId = isStation(p) ? p.routeIds?.[0] : p.route;
    p.opColor = opColor;
    p.routeColor = routeShade(opColor, String(routeId ?? ''), index.get(p.group)?.get(p.legendKey)?.routes ?? 0);
  }
}
