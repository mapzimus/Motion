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

const FADED = 'Faded = position older than 90 s';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const weatherRows: LegendRow[] = Object.entries(CONFIG.WEATHER_COLORS as Record<string, string>)
  .map(([key, color]) => ({ key, label: cap(key), color }));

const airportStatusRows: LegendRow[] = Object.entries(CONFIG.AIRPORT_STATUS_COLORS as Record<string, string>)
  .map(([key, color]) => ({ key, label: AIRPORT_STATUS_LABELS[key] ?? key, color }));

const localRows: LegendRow[] = [
  { key: 'on-demand', label: 'On-demand / community', color: '#9fc36a' },
  { key: 'flex', label: 'Flex / fixed local', color: '#f2b84b' },
  { key: 'water-taxi', label: 'Water taxi', color: '#2eb7c5' },
];

const bikeRows: LegendRow[] = [
  { key: 'ok', label: 'Bikes available', color: CONFIG.BIKE_COLOR },
  { key: 'low', label: '1-2 bikes left', color: CONFIG.BIKE_LOW_COLOR },
  { key: 'empty', label: 'Empty', color: CONFIG.BIKE_EMPTY_COLOR },
];

const taxiRows: LegendRow[] = [
  { key: 'stand', label: 'Cab stand', color: CONFIG.TAXI_COLOR },
  { key: 'company', label: 'Taxi company', color: CONFIG.TAXI_COLOR },
];

export const LEGEND_GROUPS: Record<string, LegendGroup> = {
  red: { name: 'Red Line', glyph: 'rail', notes: [FADED] },
  orange: { name: 'Orange Line', glyph: 'rail', notes: [FADED] },
  green: { name: 'Green Line', glyph: 'rail', notes: [FADED] },
  blue: { name: 'Blue Line', glyph: 'rail', notes: [FADED] },
  silver: { name: 'Silver Line', glyph: 'bus', notes: [FADED] },
  mattapan: { name: 'Mattapan Trolley', glyph: 'rail', notes: [FADED] },
  commuter: { name: 'Commuter & regional rail (MBTA, Metro-North, CTrail)', glyph: 'rail', notes: [FADED] },
  bus: { name: 'Buses, shuttles & coaches', glyph: 'bus', notes: [FADED] },
  amtrak: { name: 'Amtrak', glyph: 'rail', notes: [FADED] },
  local: { name: 'On-demand & community services', glyph: 'bus', notes: [FADED], fixedRows: localRows },
  taxi: {
    name: 'Taxis',
    glyph: 'dot',
    notes: ['Small dot = cab stand, larger = company'],
    fixedRows: taxiRows,
  },
  ferry: { name: 'Ferries', glyph: 'boat', notes: [FADED] },
  plane: { name: 'Aircraft', glyph: 'plane', notes: [] },
  'air-service': { name: 'Airline service', glyph: 'line', notes: [] },
  airport: { name: 'Airports', glyph: 'dot', notes: [] },
  vessel: { name: 'Vessels', glyph: 'boat', notes: [] },
  bike: {
    name: 'Bikeshare docks',
    glyph: 'bike',
    notes: ['Dock color shows bikes left: available, 1-2, or empty'],
    fixedRows: bikeRows,
  },
  bikeshare: { name: 'Bikeshare systems', glyph: 'bike', notes: [] },
  walking: { name: 'Walking routes', glyph: 'line', notes: [] },
  cycling: { name: 'Cycling routes', glyph: 'line', notes: [] },
  traffic: {
    name: 'Traffic',
    glyph: 'line',
    notes: ['Road color shows current speed: green flowing, red slow (511 traffic)'],
  },
  roadwork: { name: 'Roadwork', glyph: 'dot', notes: [] },
  incident: { name: 'Incidents', glyph: 'dot', notes: [] },
  camera: { name: 'Traffic cameras', glyph: 'dot', notes: [] },
  roads: { name: 'Roads', glyph: 'line', notes: [] },
  freight: { name: 'Freight rail', glyph: 'line', notes: [] },
  border: { name: 'Border crossings', glyph: 'dot', notes: [] },
  'heritage-rail': { name: 'Heritage rail', glyph: 'rail', notes: [] },
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
};
