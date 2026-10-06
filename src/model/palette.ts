// Operator palette, route shading, and vessel/plane bands. Pure data plus pure
// functions: no map, DOM, or store access. Layer groups in PALETTE_GROUPS get a
// color per operator; every other group keeps its CONFIG color.

/** 16 hues legible (>= 3:1) on the #0b0f14 map background. Slot 0 is the bus yellow. */
export const PALETTE: readonly string[] = [
  '#f2b84b', '#2b79ee', '#ee2bee', '#2bee2b', '#7bf4b8', '#ee2b65', '#b090df', '#8ccb4d',
  '#2bdaee', '#f47b9f', '#2bee8c', '#c7df90', '#cb734d', '#7bc4f4', '#c7ee2b', '#f47bf4',
];

/** The same hues at ~75-85% brightness, still 3:1 on the background, for operators ranked 16-31. */
export const PALETTE_DIM: readonly string[] = [
  '#b38838', '#2260bc', '#b020b0', '#20b020', '#5bb588', '#ba224f', '#826ba5', '#689639',
  '#20a1b0', '#b55b76', '#20b068', '#93a56b', '#965539', '#5b91b5', '#93b020', '#b55bb5',
];

/** Brand colors that beat the palette, keyed `group:operatorKey`. */
export const OFFICIAL_COLORS: Readonly<Record<string, string>> = {
  'commuter:mbta': '#80276c',
  'commuter:metro-north': '#ee0034',
  'commuter:hartford-line': '#0070c0',
};

/** Layer groups whose operators are colored from the palette. */
export const PALETTE_GROUPS: readonly string[] = ['bus', 'ferry', 'commuter', 'air-service'];

export interface OperatorStat { key: string; routes: number; live: number }

/** FNV-1a 32-bit hash of a string, reduced to [0, mod). */
export function hashIndex(s: string, mod: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % mod;
}

/**
 * Hands out palette colors to a group's operators: ranked by route count,
 * then live vehicles, then key, so the result does not depend on input order.
 * Ranks 0-15 get PALETTE, 16-31 PALETTE_DIM, beyond that a hashed dim color.
 */
export function assignPalette(group: string, stats: OperatorStat[]): Map<string, string> {
  const ranked = [...stats].sort((a, b) =>
    (b.routes - a.routes) || (b.live - a.live) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out = new Map<string, string>();
  ranked.forEach((s, rank) => {
    out.set(s.key, rank < 16
      ? PALETTE[rank]
      : PALETTE_DIM[rank < 32 ? rank - 16 : hashIndex(`${group}:${s.key}`, 16)]);
  });
  return out;
}

/**
 * Color for one operator: official brand color, then the assignment, then a
 * hashed dim color for palette groups, else the group's own fallback.
 */
export function paletteColorFor(
  group: string,
  key: string,
  assignment: Map<string, Map<string, string>>,
  fallback: string,
): string {
  const official = OFFICIAL_COLORS[`${group}:${key}`];
  if (official) return official;
  if (!PALETTE_GROUPS.includes(group)) return fallback;
  return assignment.get(group)?.get(key) ?? PALETTE_DIM[hashIndex(`${group}:${key}`, 16)];
}

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return '#' + [f(0), f(8), f(4)]
    .map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * A per-route shade of an operator's color so its routes read as a family:
 * hue shifted within +-14 degrees and lightness within +-10%, both derived
 * from the route id. An operator with one route keeps its color unchanged.
 */
export function routeShade(operatorHex: string, routeId: string, routeCount = 2): string {
  if (routeCount <= 1) return operatorHex;
  const [h, s, l] = hexToHsl(operatorHex);
  const dh = (hashIndex(`${routeId}#h`, 1001) / 1000) * 28 - 14;
  const dl = (hashIndex(`${routeId}#l`, 1001) / 1000) * 0.2 - 0.1;
  return hslToHex((h + dh + 360) % 360, s, Math.min(0.9, Math.max(0.15, l + dl)));
}

export interface VesselBand { key: string; label: string; color: string; types?: [number, number][] }

/** AIS ship-type bands. `types` are inclusive ranges of the AIS type code. */
export const VESSEL_BANDS: readonly VesselBand[] = [
  { key: 'passenger', label: 'Passenger / ferry', color: '#4db8e8', types: [[60, 69]] },
  { key: 'cargo', label: 'Cargo', color: '#8fd16b', types: [[70, 79]] },
  { key: 'tanker', label: 'Tanker', color: '#ff8a4c', types: [[80, 89]] },
  { key: 'workboat', label: 'Tug / workboat', color: '#f2b84b', types: [[31, 35], [50, 59]] },
  { key: 'fishing', label: 'Fishing', color: '#3fd1c0', types: [[30, 30]] },
  { key: 'pleasure', label: 'Sailing / pleasure', color: '#e86fb0', types: [[36, 37]] },
  { key: 'high-speed', label: 'High-speed craft', color: '#b48cf2', types: [[40, 49]] },
  { key: 'other', label: 'Other', color: '#9aa3ad' },
];

/** The band for an AIS ship type; unknown or missing types fall into "other". */
export function vesselBand(type: number | null | undefined): VesselBand {
  const t = Number(type);
  if (type != null && Number.isFinite(t)) {
    for (const b of VESSEL_BANDS) if (b.types?.some(([lo, hi]) => t >= lo && t <= hi)) return b;
  }
  return VESSEL_BANDS[VESSEL_BANDS.length - 1];
}

export interface PlaneBand { key: 'low' | 'mid' | 'high'; label: string; color: string }

/** Aircraft altitude bands (feet). */
export const PLANE_BANDS: readonly PlaneBand[] = [
  { key: 'low', label: 'Below 10,000 ft', color: '#7bc4f4' },
  { key: 'mid', label: '10,000-25,000 ft', color: '#f2b84b' },
  { key: 'high', label: 'Above 25,000 ft', color: '#f47bf4' },
];

/** The altitude band for a barometric altitude in feet; missing altitude counts as low. */
export function planeBand(altitudeFeet: number | null | undefined): PlaneBand {
  const a = Number(altitudeFeet);
  if (altitudeFeet == null || !Number.isFinite(a) || a < 10_000) return PLANE_BANDS[0];
  return a <= 25_000 ? PLANE_BANDS[1] : PLANE_BANDS[2];
}
