// Static legend descriptors for every layer group, in GROUP_KEYS order.
// Operator rows for palette groups are built at runtime from the live data;
// this file holds the names, glyphs, the non-color encodings ("notes"), and
// the fixed rows whose colors come from CONFIG.

import { CONFIG } from '../feeds/config.js';

export interface LegendRow {
  key: string;
  label: string;
  color: string;
  live?: number;
  routes?: number;
  stops?: number;
}

export type LegendGlyph = 'rail' | 'bus' | 'boat' | 'plane' | 'bike' | 'dot' | 'line' | 'area';

export interface LegendGroup {
  name: string;
  glyph: LegendGlyph;
  notes: string[];
  /** Live vehicles fade when stale; the legend shows STALE_NOTE once for these. */
  fades?: boolean;
  fixedRows?: LegendRow[];
}

/** Human labels for FAA airport status types (shared with the map popups). */
export const AIRPORT_STATUS_LABELS: Readonly<Record<string, string>> = {
  'ground-stop': 'Ground stop',
  'ground-delay': 'Ground delay program',
  'arrival-delay': 'Arrival delays',
  'departure-delay': 'Departure delays',
  closure: 'Airport closure / NOTAM',
};

/** Shown once in the legend footer when any group that `fades` is on. */
export const STALE_NOTE = 'Faded = position older than 90 s';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const weatherRows: LegendRow[] = Object.entries(CONFIG.WEATHER_COLORS as Record<string, string>)
  .map(([key, color]) => ({ key, label: cap(key), color }));

const airportStatusRows: LegendRow[] = Object.entries(CONFIG.AIRPORT_STATUS_COLORS as Record<string, string>)
  .map(([key, color]) => ({ key, label: AIRPORT_STATUS_LABELS[key] ?? key, color }));

const flightCategoryRows: LegendRow[] = [
  { key: 'VFR', label: 'VFR', color: CONFIG.FLIGHT_CATEGORY_COLORS.VFR },
  { key: 'MVFR', label: 'MVFR', color: CONFIG.FLIGHT_CATEGORY_COLORS.MVFR },
  { key: 'IFR', label: 'IFR', color: CONFIG.FLIGHT_CATEGORY_COLORS.IFR },
  { key: 'LIFR', label: 'LIFR', color: CONFIG.FLIGHT_CATEGORY_COLORS.LIFR },
];

const tfrRows: LegendRow[] = [
  { key: 'security', label: 'Security / VIP / special', color: CONFIG.TFR_COLORS.SECURITY },
  { key: 'hazards', label: 'Hazards', color: CONFIG.TFR_COLORS.HAZARDS },
  { key: 'other', label: 'Other', color: CONFIG.TFR_COLORS.default },
];

const airspaceRows: LegendRow[] = [
  { key: 'B', label: 'Class B / D', color: CONFIG.AIRSPACE_COLORS.B },
  { key: 'C', label: 'Class C', color: CONFIG.AIRSPACE_COLORS.C },
  { key: 'sua', label: 'Special use', color: CONFIG.AIRSPACE_COLORS.sua },
];

const localRows: LegendRow[] = [
  { key: 'on-demand', label: 'On-demand / community', color: '#9fc36a' },
  { key: 'flex', label: 'Flex / fixed local', color: '#f2b84b' },
  { key: 'water-taxi', label: 'Water taxi', color: '#2eb7c5' },
];

interface BikeSystem { id: string; name: string; color?: string }
const bikeSystems = CONFIG.SHARED_MOBILITY_SYSTEMS as BikeSystem[];

/** Bikeshare systems in catalog order; docks and free vehicles wear the system color. */
export const BIKE_SYSTEMS: ReadonlyArray<{ key: string; label: string; color: string }> = bikeSystems
  .map((system) => ({ key: system.id, label: system.name, color: system.color ?? CONFIG.BIKE_COLOR }));

/** Dock states that override the system color, listed after the system rows. */
export const BIKE_STATE_ROWS: LegendRow[] = [
  { key: 'low', label: '1-2 bikes left', color: CONFIG.BIKE_LOW_COLOR },
  { key: 'empty', label: 'Empty dock', color: CONFIG.BIKE_EMPTY_COLOR },
];

const taxiRows: LegendRow[] = [
  { key: 'stand', label: 'Cab stand', color: CONFIG.TAXI_COLOR },
  { key: 'company', label: 'Taxi company', color: CONFIG.TAXI_COLOR },
];

export const LEGEND_GROUPS: Record<string, LegendGroup> = {
  red: { name: 'Red Line', glyph: 'rail', notes: [], fades: true },
  orange: { name: 'Orange Line', glyph: 'rail', notes: [], fades: true },
  green: { name: 'Green Line', glyph: 'rail', notes: [], fades: true },
  blue: { name: 'Blue Line', glyph: 'rail', notes: [], fades: true },
  silver: { name: 'Silver Line', glyph: 'bus', notes: [], fades: true },
  mattapan: { name: 'Mattapan Trolley', glyph: 'rail', notes: [], fades: true },
  commuter: { name: 'Commuter & regional rail (MBTA, Metro-North, CTrail)', glyph: 'rail', notes: [], fades: true },
  bus: { name: 'Buses, shuttles & coaches', glyph: 'bus', notes: [], fades: true },
  amtrak: { name: 'Amtrak', glyph: 'rail', notes: [], fades: true },
  // Catalog points, not live positions: they never fade.
  local: { name: 'On-demand & community services', glyph: 'bus', notes: [], fixedRows: localRows },
  taxi: {
    name: 'Taxis',
    glyph: 'dot',
    notes: ['Small dot = cab stand, larger = company'],
    fixedRows: taxiRows,
  },
  ferry: { name: 'Ferries', glyph: 'boat', notes: [], fades: true },
  plane: { name: 'Aircraft', glyph: 'plane', notes: [] },
  'air-service': { name: 'Airline service', glyph: 'line', notes: [] },
  airport: { name: 'Airports', glyph: 'dot', notes: [] },
  vessel: { name: 'Vessels', glyph: 'boat', notes: [] },
  bike: {
    name: 'Bikeshare docks',
    glyph: 'bike',
    notes: ['Color shows the system; docks with 1-2 or no bikes change color'],
  },
  bikeshare: { name: 'Bikeshare systems', glyph: 'bike', notes: [] },
  walking: { name: 'Walking routes', glyph: 'line', notes: [] },
  cycling: { name: 'Cycling routes', glyph: 'line', notes: [] },
  traffic: {
    name: 'Traffic',
    glyph: 'line',
    notes: ['Road color shows current speed: green flowing, red slow (511 traffic)'],
  },
  roadwork: {
    name: 'Work zones & construction projects',
    glyph: 'dot',
    notes: ['Dashed lines are work zones. Shaded areas are Connecticut construction projects.'],
  },
  incident: { name: 'Incidents', glyph: 'dot', notes: [] },
  camera: { name: 'Traffic cameras', glyph: 'dot', notes: [] },
  'road-weather': {
    name: 'Road weather',
    glyph: 'dot',
    notes: ['Click a station for air temperature, wind, and pavement temperature'],
  },
  'message-sign': {
    name: 'Message signs',
    glyph: 'dot',
    notes: ['Click a sign for the message it is posting'],
  },
  plow: {
    name: 'Snowplows',
    glyph: 'dot',
    notes: ['Vermont trucks when they are reporting. Keene public-works trucks from the city live share. Lines are New Hampshire plow routes.'],
  },
  roads: { name: 'Roads', glyph: 'line', notes: [] },
  freight: { name: 'Freight rail', glyph: 'line', notes: [] },
  border: { name: 'Border crossings', glyph: 'dot', notes: [] },
  'heritage-rail': { name: 'Heritage rail', glyph: 'rail', notes: [] },
  aerialway: {
    name: 'Ski lifts',
    glyph: 'line',
    notes: ['Chairlifts, gondolas, and aerial tramways. Not live cabins.'],
  },
  'park-ride': { name: 'Park and ride', glyph: 'dot', notes: [] },
  'ev-charging': { name: 'EV charging', glyph: 'dot', notes: ['White ring = DC fast charging'] },
  drawbridge: { name: 'Drawbridges', glyph: 'dot', notes: [] },
  weather: {
    name: 'Weather alerts',
    glyph: 'area',
    notes: ['Area color shows NWS alert severity'],
    fixedRows: weatherRows,
  },
  'airport-status': {
    name: 'Airport status',
    glyph: 'dot',
    notes: ['Worst current FAA condition per airport'],
    fixedRows: airportStatusRows,
  },
  'airport-weather': {
    name: 'Airport weather',
    glyph: 'dot',
    notes: ['Dot color shows METAR flight category'],
    fixedRows: flightCategoryRows,
  },
  tfr: {
    name: 'Flight restrictions',
    glyph: 'area',
    notes: ['Area color shows restriction type'],
    fixedRows: tfrRows,
  },
  airspace: {
    name: 'Airspace',
    glyph: 'line',
    notes: ['Charted Class B, C, D and special use; check current charts'],
    fixedRows: airspaceRows,
  },
};
