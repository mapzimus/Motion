// Pure parsers for two public vehicle feeds. index.ts owns the fetch.
// Peter Pan's tracker repeats one GPS fix across many trip rows; those rows
// are one coach. Keene's public viewer is last-parked city trucks, including
// fixes that are hours or months old.

import { insideNewEngland } from './regions';

const MPH_PER_MPS = 2.23694;
// A Keene fix newer than this is a current parked (or moving) report.
// Older fixes stay on the map as last-parked positions.
export const KEENE_FRESH_MS = 6 * 60 * 60 * 1000;

export interface PeterPanCoach {
  id: string;
  feed: 'peter-pan';
  agency: 'Peter Pan Bus Lines';
  lng: number;
  lat: number;
  route: string;
  trip: string;
  label: string;
  bearing: number | null;
  speedMps: number | null;
  updatedAt: string;
  from: string;
  to: string;
}

export interface CityTruckFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, string | number | boolean>;
}

interface ActiveVehicle {
  current_wgs84_latitude_degrees?: unknown;
  current_wgs84_longitude_degrees?: unknown;
  current_speed_mph?: unknown;
  current_forward_azimuth_degrees?: unknown;
  last_update_time_unix?: unknown;
}

interface Departure {
  active_vehicle?: ActiveVehicle;
  tracking?: {
    is_completed?: unknown;
    is_future_trip?: unknown;
    is_cancelled?: unknown;
    has_no_gps?: unknown;
    has_no_vehicle?: unknown;
  };
  trip?: {
    id?: unknown;
    route_id?: unknown;
    departure_location_name?: unknown;
    arrival_location_name?: unknown;
  };
}

function finite(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function identifier(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

function flag(value: unknown): boolean {
  return value === true;
}

function departuresOf(payload: unknown): Departure[] {
  if (!payload || typeof payload !== 'object') return [];
  const stops = (payload as { stops?: unknown }).stops;
  if (!Array.isArray(stops)) return [];
  return stops.flatMap((stop) => {
    if (!stop || typeof stop !== 'object') return [];
    const rows = (stop as { chronological_departures?: unknown }).chronological_departures;
    return Array.isArray(rows) ? rows as Departure[] : [];
  });
}

function liveDeparture(row: Departure): PeterPanCoach | null {
  const tracking = row.tracking ?? {};
  if (
    flag(tracking.is_completed)
    || flag(tracking.is_future_trip)
    || flag(tracking.is_cancelled)
    || flag(tracking.has_no_gps)
    || flag(tracking.has_no_vehicle)
  ) return null;
  const vehicle = row.active_vehicle;
  const lat = finite(vehicle?.current_wgs84_latitude_degrees);
  const lng = finite(vehicle?.current_wgs84_longitude_degrees);
  if (lat === null || lng === null || !insideNewEngland(lng, lat)) return null;
  const tripId = text(row.trip?.id);
  if (!tripId) return null;
  const updated = finite(vehicle?.last_update_time_unix);
  if (updated === null) return null;
  const speedMph = finite(vehicle?.current_speed_mph);
  const heading = finite(vehicle?.current_forward_azimuth_degrees);
  const moving = speedMph !== null && speedMph > 0;
  return {
    id: `peter-pan-${tripId}`,
    feed: 'peter-pan',
    agency: 'Peter Pan Bus Lines',
    lng,
    lat,
    route: text(row.trip?.route_id),
    trip: tripId,
    label: '',
    bearing: heading !== null && (moving || heading !== 0) ? heading : null,
    speedMps: speedMph === null ? null : speedMph / MPH_PER_MPS,
    updatedAt: new Date(updated * 1000).toISOString(),
    from: text(row.trip?.departure_location_name),
    to: text(row.trip?.arrival_location_name),
  };
}

function coordinateKey(coach: PeterPanCoach): string {
  return `${coach.lat.toFixed(5)},${coach.lng.toFixed(5)}`;
}

function newer(candidate: PeterPanCoach, current: PeterPanCoach): boolean {
  const candidateAt = Date.parse(candidate.updatedAt);
  const currentAt = Date.parse(current.updatedAt);
  if (candidateAt !== currentAt) return candidateAt > currentAt;
  return candidate.trip < current.trip;
}

// One marker per coach. The tracker publishes a fix once per trip, so several
// trip rows often share one coordinate. Keep the newest report at that fix.
export function peterPanCoaches(payloads: unknown[]): PeterPanCoach[] {
  const byTrip = new Map<string, PeterPanCoach>();
  for (const payload of payloads) {
    for (const row of departuresOf(payload)) {
      const coach = liveDeparture(row);
      if (!coach) continue;
      const existing = byTrip.get(coach.trip);
      if (!existing || newer(coach, existing)) byTrip.set(coach.trip, coach);
    }
  }
  const byFix = new Map<string, PeterPanCoach>();
  for (const coach of byTrip.values()) {
    const key = coordinateKey(coach);
    const existing = byFix.get(key);
    if (!existing || newer(coach, existing)) byFix.set(key, coach);
  }
  return [...byFix.values()];
}

function devicesOf(payload: unknown): Array<Record<string, unknown>> {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
  const token = data.fleetViewerToken && typeof data.fleetViewerToken === 'object'
    ? data.fleetViewerToken as Record<string, unknown>
    : null;
  const devices = token?.devices;
  if (!Array.isArray(devices)) return [];
  return devices.filter((device) => device && typeof device === 'object') as Array<Record<string, unknown>>;
}

function lastFix(location: unknown): Record<string, unknown> | null {
  if (Array.isArray(location)) {
    const last = location[location.length - 1];
    return last && typeof last === 'object' ? last as Record<string, unknown> : null;
  }
  if (location && typeof location === 'object') return location as Record<string, unknown>;
  return null;
}

export function keeneCityTrucks(payload: unknown, nowMs: number): CityTruckFeature[] {
  const features: CityTruckFeature[] = [];
  for (const device of devicesOf(payload)) {
    const fix = lastFix(device.location);
    const lat = finite(fix?.latitude);
    const lng = finite(fix?.longitude);
    if (lat === null || lng === null || !insideNewEngland(lng, lat)) continue;
    const reported = finite(fix?.time);
    if (reported === null) continue;
    const fresh = nowMs - reported <= KEENE_FRESH_MS;
    const speedMps = finite(fix?.speed) ?? 0;
    const name = text(device.name);
    const id = identifier(device.id) || name || String(features.length + 1);
    const moving = fresh && speedMps >= 0.5;
    features.push({
      type: 'Feature',
      id: `keene-${id}`,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        group: 'city-truck',
        dataStatus: fresh ? 'live' : 'reference',
        color: '#d7a15a',
        title: name ? `City truck · ${name}` : 'City truck',
        status: moving
          ? `City truck · ${Math.round(speedMps * MPH_PER_MPS)} mph`
          : (fresh ? 'Parked' : 'Last parked'),
        provider: 'City of Keene',
        sourceUrl: 'https://cloud.samsara.com/o/10007013/fleet/viewer/9UjyA9zT0itLijnVB1po',
        updatedAt: new Date(reported).toISOString(),
      },
    });
  }
  return features;
}
