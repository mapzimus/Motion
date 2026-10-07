// City of Keene public-works trucks, from the live share linked on the city's
// snow-plow page. The share token is published there. A personal Samsara
// account does not see this fleet. The page's own CSRF handshake is required
// by that host; it is not a user credential. Driver names are not requested.

import type { RoadPointFeature } from './road-extras';
import { insideNewEngland } from './regions';

export const KEENE_SOURCE_URL = 'https://keenenh.gov/news/snow-plow-tracking/';
export const KEENE_VIEWER_URL = 'https://cloud.samsara.com/o/10007013/fleet/viewer/9UjyA9zT0itLijnVB1po';
const KEENE_SHARE_TOKEN = '9UjyA9zT0itLijnVB1po';
const KEENE_CSRF_URL = 'https://us10-ws.cloud.samsara.com/r/auth/csrf';
const KEENE_GRAPHQL_URL = 'https://us10-ws.cloud.samsara.com/r/graphql?q=FleetViewer';
const KEENE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// The share does not say whether speed is meters per second. The number is
// not shown. Values under 1 are the jitter seen on parked trucks.
const KEENE_MOVING_SPEED = 1;
const USER_AGENT = 'motion-map (github.com/mapzimus/Motion)';

const FLEET_QUERY = `query FleetViewer($token: string!, $duration: int64!) {
  fleetViewerToken(token: $token) {
    devices(feature: "fleetTrackable") {
      name
      id
      location: fleetViewerLocation(duration: $duration) {
        time
        latitude
        longitude
        heading
        speed
        formatted
      }
    }
  }
}`;

function numberAt(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function epochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber < 1e12 ? asNumber * 1000 : asNumber;
  }
  return null;
}

function devicesOf(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: { fleetViewerToken?: { devices?: unknown } } }).data;
  const devices = data?.fleetViewerToken?.devices;
  return Array.isArray(devices) ? devices : [];
}

function newestLocation(location: unknown): Record<string, unknown> | null {
  const points = Array.isArray(location) ? location : location && typeof location === 'object' ? [location] : [];
  let best: Record<string, unknown> | null = null;
  let bestMs = -Infinity;
  for (const point of points) {
    if (!point || typeof point !== 'object') continue;
    const record = point as Record<string, unknown>;
    const time = epochMs(record.time) ?? -Infinity;
    if (time >= bestMs) {
      best = record;
      bestMs = time;
    }
  }
  return best;
}

export function parseKeeneViewer(payload: unknown, nowMs: number): RoadPointFeature[] {
  const features: RoadPointFeature[] = [];
  for (const device of devicesOf(payload)) {
    if (!device || typeof device !== 'object') continue;
    const record = device as { id?: unknown; name?: unknown; location?: unknown };
    const location = newestLocation(record.location);
    if (!location) continue;
    const lat = numberAt(location.latitude);
    const lng = numberAt(location.longitude);
    const updatedMs = epochMs(location.time);
    if (lat === null || lng === null || updatedMs === null || !insideNewEngland(lng, lat)) continue;
    if (updatedMs > nowMs + 5 * 60 * 1000 || nowMs - updatedMs > KEENE_MAX_AGE_MS) continue;
    const id = String(record.id ?? record.name ?? features.length + 1);
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : `Keene truck ${id}`;
    const speed = numberAt(location.speed);
    const moving = speed !== null && speed > KEENE_MOVING_SPEED;
    const address = typeof location.formatted === 'string' ? location.formatted.trim() : '';
    features.push({
      type: 'Feature',
      id: `keene-${id}`,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        group: 'plow',
        dataStatus: 'live',
        color: '#d6e8ff',
        title: name,
        status: moving ? 'Moving · City of Keene' : 'Parked · City of Keene',
        ...(address ? { details: address } : {}),
        provider: 'City of Keene public works',
        sourceUrl: KEENE_SOURCE_URL,
        updatedAt: new Date(updatedMs).toISOString(),
      },
    });
  }
  return features;
}

export function combinePlowFeeds(
  vtrans: RoadPointFeature[] | null,
  keene: RoadPointFeature[] | null,
): { provider: string; coverage: string[]; note: string; features: RoadPointFeature[] } | null {
  if (!vtrans && !keene) return null;
  const providers: string[] = [];
  const coverage: string[] = [];
  const notes: string[] = [];
  if (vtrans) {
    providers.push('VTrans live plow trucks');
    coverage.push('vt');
    notes.push(vtrans.length
      ? 'Live Vermont plow trucks.'
      : 'No Vermont plow trucks are reporting. The file is empty outside winter.');
  } else {
    notes.push('The Vermont plow file is unavailable.');
  }
  if (keene) {
    providers.push('City of Keene public works');
    coverage.push('nh');
    notes.push(keene.length
      ? 'Keene public-works trucks from the city live share. Positions older than a day are left off.'
      : 'No Keene trucks have reported in the last day.');
  } else {
    notes.push('The Keene live share is unavailable.');
  }
  return {
    provider: providers.join(' and '),
    coverage,
    note: notes.join(' '),
    features: [...(vtrans ?? []), ...(keene ?? [])],
  };
}

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  return raw.map((value) => value.split(';', 1)[0]?.trim() ?? '').filter(Boolean).join('; ');
}

export async function fetchKeeneTrucks(nowMs = Date.now()): Promise<RoadPointFeature[] | null> {
  try {
    const csrf = await fetch(KEENE_CSRF_URL, {
      headers: {
        accept: 'application/json',
        origin: 'https://cloud.samsara.com',
        'user-agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!csrf.ok) return null;
    const token = (await csrf.json() as { csrf_token?: unknown }).csrf_token;
    const cookie = cookieHeader(csrf);
    if (typeof token !== 'string' || !token || !cookie) return null;
    const upstream = await fetch(KEENE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json; version=2',
        'content-type': 'application/json',
        origin: 'https://cloud.samsara.com',
        referer: KEENE_VIEWER_URL,
        'x-csrf-token': token,
        cookie,
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({
        query: FLEET_QUERY,
        variables: { token: KEENE_SHARE_TOKEN, duration: 30000 },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) return null;
    return parseKeeneViewer(await upstream.json(), nowMs);
  } catch {
    return null;
  }
}
