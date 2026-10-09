// Operator color and per-route shade for one live vehicle. Pure: the color and
// route-count lookups are passed in, so the feeds and the legend bridge share it.
import { PALETTE_GROUPS, routeShade } from './palette.js';

export interface VehicleColorProps {
  group?: string;
  legendKey?: string;
  /** The CONFIG mode color the vehicle falls back to. */
  modeColor?: string;
  color?: string;
  routeColor?: string;
  route?: string;
  /** Feed-prefixed route id matching the static route features, '' when unknown. */
  shadeKey?: string;
}

export interface VehicleColors { color: string; routeColor: string }

/**
 * Colors for a vehicle in a palette group with an operator key, else null so
 * the caller keeps the vehicle's own color (subway lines, vessel bands, docks).
 */
export function vehicleColors(
  props: VehicleColorProps,
  colorFor: (group: string, key: string, fallback: string) => string,
  routeCountFor: (group: string, key: string) => number,
): VehicleColors | null {
  const { group, legendKey } = props;
  if (!group || !legendKey || !PALETTE_GROUPS.includes(group)) return null;
  const color = colorFor(group, legendKey, props.modeColor ?? props.color ?? '#8a939c');
  const routeColor = props.shadeKey
    ? routeShade(color, props.shadeKey, routeCountFor(group, legendKey))
    : color;
  return { color, routeColor };
}
