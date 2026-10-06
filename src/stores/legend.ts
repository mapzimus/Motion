// Legend data shared by the map and the legend panel. Colors come from the
// static route index only, so live vehicle counts can never reshuffle them.
import { signal, computed } from '@preact/signals';
import {
  PALETTE_GROUPS,
  assignPalette,
  paletteColorFor,
  type OperatorStat,
} from '../model/palette.js';
import { vehicleColors, type VehicleColorProps, type VehicleColors } from '../model/vehicleColors.js';
import { buildLegendSections, type ViewportRoutes } from '../model/legendRows.js';
import { visibleGroups } from './layers.js';

export interface RouteKeyEntry { label: string; routes: number; stops: number }
export interface LiveKeyEntry { n: number; label?: string; color?: string }
export type RouteKeyIndex = Map<string, Map<string, RouteKeyEntry>>;
export type LiveKeyCounts = Map<string, Map<string, LiveKeyEntry>>;

/** group -> operator key -> label and static route/stop counts for the active region. */
export const routeKeyIndex = signal<RouteKeyIndex>(new Map());
/** group -> operator key -> live vehicle count (populated by the feeds). */
export const liveKeyCounts = signal<LiveKeyCounts>(new Map());

export function setRouteKeyIndex(index: RouteKeyIndex) {
  routeKeyIndex.value = index;
}

export function setLiveKeyCounts(counts: LiveKeyCounts) {
  liveKeyCounts.value = counts;
}

/** group -> operator key -> palette color, ranked by static route count. */
export const paletteAssignment = computed(() => {
  const out = new Map<string, Map<string, string>>();
  for (const group of PALETTE_GROUPS) {
    const keys = routeKeyIndex.value.get(group);
    if (!keys) continue;
    const stats: OperatorStat[] = [...keys].map(([key, e]) => ({ key, routes: e.routes, live: 0 }));
    out.set(group, assignPalette(group, stats));
  }
  return out;
});

/** Operator color for feed normalizers; reads without subscribing. */
export function colorFor(group: string, key: string, fallback: string): string {
  return paletteColorFor(group, key, paletteAssignment.peek(), fallback);
}

/** How many routes an operator has in the active region (0 when unknown). */
export function routeCountFor(group: string, key: string): number {
  return routeKeyIndex.peek().get(group)?.get(key)?.routes ?? 0;
}

/** A live vehicle's operator color and route shade under the current assignment, or null to keep its own. */
export function liveVehicleColors(props: VehicleColorProps): VehicleColors | null {
  return vehicleColors(props, colorFor, routeCountFor);
}

/** Apply liveVehicleColors to a feed item's props in place; returns the item. */
export function paintVehicle<T extends { props: VehicleColorProps & { routeColor?: string } }>(item: T): T {
  const colors = liveVehicleColors(item.props);
  if (colors) Object.assign(item.props, colors);
  return item;
}

/** Map zoom as of the last zoomend; picks operator rows or viewport routes. */
export const legendZoom = signal(0);
/** group -> route key -> route currently rendered in the viewport. */
export const viewportRoutes = signal<ViewportRoutes>(new Map());
/** Subway group -> line color, for the section header swatch. */
export const subwayColors = signal<Map<string, string>>(new Map());

export function setLegendZoom(zoom: number) {
  legendZoom.value = zoom;
}

export function setViewportRoutes(routes: ViewportRoutes) {
  viewportRoutes.value = routes;
}

export function setSubwayColors(colors: Map<string, string>) {
  subwayColors.value = colors;
}

/** One legend section per visible group, in panel order. */
export const legendSections = computed(() => buildLegendSections({
  groups: visibleGroups.value,
  zoom: legendZoom.value,
  index: routeKeyIndex.value,
  live: liveKeyCounts.value,
  assignment: paletteAssignment.value,
  viewport: viewportRoutes.value,
  subwayColors: subwayColors.value,
}));
