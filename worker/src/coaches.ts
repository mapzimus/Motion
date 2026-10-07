// Peter Pan's public coach tracker. The page publishes its client config,
// including a key that starts with PUBLIC. This module reads that config at
// request time so the key is never stored here, then keeps one coach per GPS
// fix. Many trip rows copy the same coordinates.

import { insideNewEngland } from './regions';

export const PETER_PAN_CONFIG_URL = 'https://bustracker.peterpanbus.com/configs/global.js?v=3';
export const PETER_PAN_SOURCE_URL = 'https://bustracker.peterpanbus.com/';

// Terminals that cover the New England network. One stop misses a coach that
// never calls there. Albany is outside the map and is not polled.
export const PETER_PAN_STOPS = [
  '6709', // Boston South Station
  '6708', // Logan Airport
  '6697', // Springfield
  '6703', // Worcester
  '6751', // Providence
  '6734', // Hyannis
  '6690', // Hartford
  '6743', // New Haven
  '6748', // Pittsfield
  '6673', // Amherst
  '6773', // Woods Hole
] as const;

export const COACH_MAX_AGE_MS = 20 * 60 * 1000;
const LOOKBACK_SECONDS = 6 * 60 * 60;
const LOOKAHEAD_SECONDS = 48 * 60 * 60;
const USER_AGENT = 'motion-map (github.com/mapzimus/Motion)';

export interface CoachFix {
  id: string;
  lng: number;
  lat: number;
  bearing: number | null;
  speedMph: number | null;
  updatedAt: string;
  title: string;
  dest: string;
  route: string;
}

interface ParsedConfig {
  apiUrl: string;
  apiKey: string;
}

export function parsePeterPanConfig(source: string): ParsedConfig | null {
  const url = source.match(/API_URL:\s*'(https:\/\/peterpan\.origin\.utrack\.com\/api)'/)?.[1];
  const apiKey = source.match(/API_KEY:\s*'(PUBLIC[A-Z0-9]{8,})'/)?.[1];
  if (!url || !apiKey) return null;
  return { apiUrl: url, apiKey };
}

function numberAt(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function textAt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function departuresOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const stops = (payload as { stops?: unknown }).stops;
  if (!Array.isArray(stops)) return [];
  return stops.flatMap((stop) => {
    if (!stop || typeof stop !== 'object') return [];
    const departures = (stop as { chronological_departures?: unknown }).chronological_departures;
    return Array.isArray(departures) ? departures : [];
  });
}

function coachFromDeparture(departure: unknown, nowMs: number): (CoachFix & { updatedMs: number }) | null {
  if (!departure || typeof departure !== 'object') return null;
  const record = departure as {
    active_vehicle?: unknown;
    tracking?: { has_no_gps?: unknown; has_no_vehicle?: unknown; is_cancelled?: unknown };
    trip?: {
      short_name?: unknown;
      route_id?: unknown;
      departure_location_name?: unknown;
      arrival_location_name?: unknown;
    };
  };
  const tracking = record.tracking ?? {};
  if (tracking.has_no_gps || tracking.has_no_vehicle || tracking.is_cancelled) return null;
  const vehicle = record.active_vehicle;
  if (!vehicle || typeof vehicle !== 'object') return null;
  const position = vehicle as {
    current_wgs84_latitude_degrees?: unknown;
    current_wgs84_longitude_degrees?: unknown;
    current_forward_azimuth_degrees?: unknown;
    current_speed_mph?: unknown;
    last_update_time_unix?: unknown;
  };
  const lat = numberAt(position.current_wgs84_latitude_degrees);
  const lng = numberAt(position.current_wgs84_longitude_degrees);
  const updatedSec = numberAt(position.last_update_time_unix);
  if (lat === null || lng === null || updatedSec === null || !insideNewEngland(lng, lat)) return null;
  const updatedMs = updatedSec * 1000;
  if (updatedMs > nowMs + 5 * 60 * 1000 || nowMs - updatedMs > COACH_MAX_AGE_MS) return null;

  const roundedLat = Math.round(lat * 1e5) / 1e5;
  const roundedLng = Math.round(lng * 1e5) / 1e5;
  const trip = record.trip ?? {};
  const from = textAt(trip.departure_location_name);
  const to = textAt(trip.arrival_location_name);
  const schedule = textAt(trip.short_name);
  const route = textAt(trip.route_id) || schedule;
  return {
    id: `pp_${roundedLat.toFixed(5)}_${roundedLng.toFixed(5)}`,
    lng,
    lat,
    bearing: numberAt(position.current_forward_azimuth_degrees),
    speedMph: numberAt(position.current_speed_mph),
    updatedAt: new Date(updatedMs).toISOString(),
    updatedMs,
    title: schedule ? `Peter Pan · ${schedule}` : 'Peter Pan',
    dest: from && to ? `${from} → ${to}` : to || from,
    route,
  };
}

// One GPS fix is copied onto every trip that coach is assigned to. Keep the
// newest report at that rounded coordinate.
export function coachesFromStopFeeds(payloads: unknown[], nowMs: number): CoachFix[] {
  const byId = new Map<string, CoachFix & { updatedMs: number }>();
  for (const payload of payloads) {
    for (const departure of departuresOf(payload)) {
      const coach = coachFromDeparture(departure, nowMs);
      if (!coach) continue;
      const previous = byId.get(coach.id);
      if (!previous || coach.updatedMs >= previous.updatedMs) byId.set(coach.id, coach);
    }
  }
  return [...byId.values()].map(({ updatedMs: _updatedMs, ...coach }) => coach);
}

async function readStop(apiUrl: string, apiKey: string, stopId: string, nowSec: number): Promise<unknown> {
  const url = `${apiUrl}/public-departures-by-stop-v1/${stopId}/${nowSec - LOOKBACK_SECONDS}/${nowSec + LOOKAHEAD_SECONDS}?api_key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`stop ${stopId} ${response.status}`);
  return response.json();
}

export async function loadCoachVehicles(nowMs = Date.now()): Promise<{ ok: true; vehicles: CoachFix[] } | { ok: false }> {
  const configResponse = await fetch(PETER_PAN_CONFIG_URL, {
    headers: { accept: 'application/javascript', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!configResponse?.ok) return { ok: false };
  const config = parsePeterPanConfig(await configResponse.text());
  if (!config) return { ok: false };

  const nowSec = Math.floor(nowMs / 1000);
  const settled = await Promise.allSettled(
    PETER_PAN_STOPS.map((stopId) => readStop(config.apiUrl, config.apiKey, stopId, nowSec)),
  );
  const payloads = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  if (!payloads.length) return { ok: false };
  return { ok: true, vehicles: coachesFromStopFeeds(payloads, nowMs) };
}
