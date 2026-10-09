// Public coach trackers (Peter Pan and C&J). Each page publishes a client
// config whose key starts with PUBLIC. The key is read at request time and
// is never stored here. One coach is kept per GPS fix; many trip rows copy
// the same coordinates.

import https from 'node:https';

import { insideNewEngland } from './regions';

export const PETER_PAN_CONFIG_URL = 'https://bustracker.peterpanbus.com/configs/global.js?v=3';
export const PETER_PAN_SOURCE_URL = 'https://bustracker.peterpanbus.com/';
export const CJ_CONFIG_URL = 'https://bustracker.ridecj.com/configs/global.js?v=3';
export const CJ_SOURCE_URL = 'https://bustracker.ridecj.com/';

// The C&J tracker host sends a Sectigo chain for an SSL.com leaf, so a normal
// fetch cannot verify it. These are the certificate's own AIA issuers.
const CJ_CA_URLS = [
  'http://cert.ssl.com/SSLcom-TLS-Root-2022-RSA.cer',
  'http://cert.ssl.com/SSL.com-TLS-I-RSA-R1.cer',
] as const;

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

// New York is polled so a through coach still in New England is not missed.
// Positions outside New England are dropped. This does not add New York coverage.
export const CJ_STOPS = [
  '955', // Dover
  '949', // Portsmouth
  '4665', // Seabrook
  '951', // Logan Airport
  '950', // South Station
  '1656', // New York City
] as const;

export const COACH_MAX_AGE_MS = 20 * 60 * 1000;
const LOOKBACK_SECONDS = 6 * 60 * 60;
const LOOKAHEAD_SECONDS = 48 * 60 * 60;
const USER_AGENT = 'motion-map (github.com/mapzimus/Motion)';

export interface CoachOperator {
  id: string;
  name: string;
  legendKey: string;
  legendLabel: string;
  provider: string;
  meta: string;
  configUrl: string;
  sourceUrl: string;
  apiHost: string;
  stops: readonly string[];
  idPrefix: string;
}

export const PETER_PAN: CoachOperator = {
  id: 'peter-pan',
  name: 'Peter Pan',
  legendKey: 'peter-pan',
  legendLabel: 'Peter Pan Bus Lines',
  provider: 'Peter Pan Bus Lines',
  meta: 'Peter Pan tracker',
  configUrl: PETER_PAN_CONFIG_URL,
  sourceUrl: PETER_PAN_SOURCE_URL,
  apiHost: 'peterpan.origin.utrack.com',
  stops: PETER_PAN_STOPS,
  idPrefix: 'pp',
};

export const CJ: CoachOperator = {
  id: 'cj',
  name: 'C&J',
  legendKey: 'cj',
  legendLabel: 'C&J Bus Lines',
  provider: 'C&J Bus Lines',
  meta: 'C&J tracker',
  configUrl: CJ_CONFIG_URL,
  sourceUrl: CJ_SOURCE_URL,
  apiHost: 'cj.origin.utrack.com',
  stops: CJ_STOPS,
  idPrefix: 'cj',
};

export const COACH_OPERATORS = [PETER_PAN, CJ] as const;

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
  legendKey: string;
  legendLabel: string;
  provider: string;
  sourceUrl: string;
  meta: string;
}

interface ParsedConfig {
  apiUrl: string;
  apiKey: string;
}

export function parseUtrackConfig(source: string, apiHost: string): ParsedConfig | null {
  const escaped = apiHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const url = source.match(new RegExp(`API_URL:\\s*'(https://${escaped}/api)'`))?.[1];
  const apiKey = source.match(/API_KEY:\s*'(PUBLIC[A-Z0-9]{8,})'/)?.[1];
  if (!url || !apiKey) return null;
  return { apiUrl: url, apiKey };
}

export function parsePeterPanConfig(source: string): ParsedConfig | null {
  return parseUtrackConfig(source, PETER_PAN.apiHost);
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

function coachFromDeparture(
  departure: unknown,
  nowMs: number,
  operator: CoachOperator,
): (CoachFix & { updatedMs: number }) | null {
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
    id: `${operator.idPrefix}_${roundedLat.toFixed(5)}_${roundedLng.toFixed(5)}`,
    lng,
    lat,
    bearing: numberAt(position.current_forward_azimuth_degrees),
    speedMph: numberAt(position.current_speed_mph),
    updatedAt: new Date(updatedMs).toISOString(),
    updatedMs,
    title: schedule ? `${operator.name} · ${schedule}` : operator.name,
    dest: from && to ? `${from} → ${to}` : to || from,
    route,
    legendKey: operator.legendKey,
    legendLabel: operator.legendLabel,
    provider: operator.provider,
    sourceUrl: operator.sourceUrl,
    meta: operator.meta,
  };
}

// One GPS fix is copied onto every trip that coach is assigned to. Keep the
// newest report at that rounded coordinate.
export function coachesFromStopFeeds(
  payloads: unknown[],
  nowMs: number,
  operator: CoachOperator = PETER_PAN,
): CoachFix[] {
  const byId = new Map<string, CoachFix & { updatedMs: number }>();
  for (const payload of payloads) {
    for (const departure of departuresOf(payload)) {
      const coach = coachFromDeparture(departure, nowMs, operator);
      if (!coach) continue;
      const previous = byId.get(coach.id);
      if (!previous || coach.updatedMs >= previous.updatedMs) byId.set(coach.id, coach);
    }
  }
  return [...byId.values()].map(({ updatedMs: _updatedMs, ...coach }) => coach);
}

function derToPem(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  const b64 = btoa(binary);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

// bustracker.ridecj.com presents the wrong intermediate. Trust the SSL.com
// root and issuing CA named on the leaf, then read the same public config.
async function readCjTrackerConfig(): Promise<string | null> {
  const pems: string[] = [];
  for (const url of CJ_CA_URLS) {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);
    if (!response?.ok) return null;
    pems.push(derToPem(new Uint8Array(await response.arrayBuffer())));
  }
  return new Promise((resolve) => {
    const request = https.get(CJ_CONFIG_URL, {
      ca: pems,
      headers: { accept: 'application/javascript', 'user-agent': USER_AGENT },
      timeout: 12_000,
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk as Buffer));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
  });
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

async function readOperatorConfig(operator: CoachOperator): Promise<ParsedConfig | null> {
  if (operator.id === 'cj') {
    const text = await readCjTrackerConfig();
    return text ? parseUtrackConfig(text, operator.apiHost) : null;
  }
  const configResponse = await fetch(operator.configUrl, {
    headers: { accept: 'application/javascript', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!configResponse?.ok) return null;
  return parseUtrackConfig(await configResponse.text(), operator.apiHost);
}

async function loadOperator(
  operator: CoachOperator,
  nowMs: number,
): Promise<{ ok: true; vehicles: CoachFix[]; provider: string } | { ok: false }> {
  const config = await readOperatorConfig(operator);
  if (!config) return { ok: false };
  const nowSec = Math.floor(nowMs / 1000);
  const settled = await Promise.allSettled(
    operator.stops.map((stopId) => readStop(config.apiUrl, config.apiKey, stopId, nowSec)),
  );
  const payloads = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  if (!payloads.length) return { ok: false };
  return { ok: true, vehicles: coachesFromStopFeeds(payloads, nowMs, operator), provider: operator.provider };
}

export async function loadCoachVehicles(nowMs = Date.now()): Promise<
  { ok: true; vehicles: CoachFix[]; provider: string } | { ok: false }
> {
  const settled = await Promise.all(COACH_OPERATORS.map((operator) => loadOperator(operator, nowMs)));
  const ready = settled.filter((result): result is { ok: true; vehicles: CoachFix[]; provider: string } => result.ok);
  if (!ready.length) return { ok: false };
  return {
    ok: true,
    vehicles: ready.flatMap((result) => result.vehicles),
    provider: ready.map((result) => result.provider).join(' and '),
  };
}
