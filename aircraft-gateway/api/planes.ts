const ALLOWED_ORIGINS = new Set([
  'https://mapzimus.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);
const ADSB_LOL_BASE = 'https://api.adsb.lol/v2/point';
const ADSB_FI_BASE = 'https://opendata.adsb.fi/api/v3';

const PLANE_PROBES = {
  boston: [{ lat: 42.36, lon: -71.01, radius: 60 }],
  ma: [{ lat: 42.18, lon: -71.8, radius: 145 }],
  ct: [{ lat: 41.6, lon: -72.7, radius: 95 }],
  ri: [{ lat: 41.68, lon: -71.5, radius: 70 }],
  nh: [{ lat: 43.85, lon: -71.55, radius: 125 }],
  vt: [{ lat: 44.05, lon: -72.7, radius: 125 }],
  me: [
    { lat: 44.1, lon: -69.9, radius: 160 },
    { lat: 46.1, lon: -68.4, radius: 150 },
  ],
  'new-england': [
    { lat: 41.75, lon: -72.5, radius: 120 },
    { lat: 42.8, lon: -71.3, radius: 125 },
    { lat: 44.25, lon: -72.0, radius: 150 },
    { lat: 45.5, lon: -68.8, radius: 180 },
  ],
} as const;

type RegionId = keyof typeof PLANE_PROBES;
type AircraftPayload = { ac?: Array<Record<string, unknown>> };
type AircraftProbeResult = { payload: AircraftPayload; provider: string };

// readsb dbFlags bits: 1 military, 2 interesting, 4 PIA (privacy ICAO
// address), 8 LADD (FAA limiting aircraft data displayed).
const DB_FLAG_PIA = 4;
const DB_FLAG_LADD = 8;

export type RelayAircraft = {
  id: string;
  lng: number;
  lat: number;
  callsign: string;
  aircraftType: string;
  bearing: number | null;
  altitudeFeet: number | null;
  groundSpeedKnots: number | null;
  onGround: boolean;
  updatedAt: string;
  // Added 2026-10; older clients ignore them.
  category: string | null; // ADS-B emitter category, e.g. "A3" (large) or "A7" (rotorcraft)
  squawk: string | null; // four octal digits
  emergency: string | null; // readsb emergency state: "none", "general", "nordo", ...
  registration: string | null; // withheld for PIA, LADD and rotorcraft
  verticalRateFpm: number | null;
  dbFlags: number;
};

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function matchingText(value: unknown, pattern: RegExp): string | null {
  const text = String(value ?? '').trim();
  return pattern.test(text) ? text : null;
}

// One upstream aircraft record (ADSB.lol or adsb.fi, both readsb JSON) to the
// relay's public shape. This is an allowlist: anything not copied here, such as
// adsb.fi's owner/operator `ownOp`, never leaves the relay.
export function normalizeAircraft(
  item: Record<string, unknown>,
  now = Date.now(),
): RelayAircraft | null {
  const lat = numberValue(item.lat);
  const lng = numberValue(item.lon);
  const hex = String(item.hex ?? '').trim();
  if (lat === null || lng === null || !hex) return null;
  const seenSeconds = numberValue(item.seen) ?? 0;
  const dbFlags = Math.max(0, Math.trunc(numberValue(item.dbFlags) ?? 0));
  const category = matchingText(item.category, /^[A-D][0-7]$/i)?.toUpperCase() ?? null;
  // Privacy: PIA and LADD aircraft have asked not to be identified, and a
  // helicopter's tail number tends to point at a person (news, police,
  // medevac, private owners). Show those generically.
  const withholdRegistration = Boolean(dbFlags & (DB_FLAG_PIA | DB_FLAG_LADD)) || category === 'A7';
  const registration = withholdRegistration
    ? null
    : matchingText(item.r, /^[A-Z0-9][A-Z0-9-]{0,9}$/i)?.toUpperCase() ?? null;
  return {
    id: hex,
    lng,
    lat,
    callsign: String(item.flight ?? '').trim(),
    aircraftType: String(item.t ?? ''),
    bearing: numberValue(item.track),
    altitudeFeet: item.alt_baro === 'ground' ? null : numberValue(item.alt_baro),
    groundSpeedKnots: numberValue(item.gs),
    onGround: item.alt_baro === 'ground',
    updatedAt: new Date(now - seenSeconds * 1000).toISOString(),
    category,
    squawk: matchingText(item.squawk, /^[0-7]{4}$/),
    emergency: matchingText(item.emergency, /^[a-z]{1,16}$/i)?.toLowerCase() ?? null,
    registration,
    verticalRateFpm: numberValue(item.baro_rate) ?? numberValue(item.geom_rate),
    dbFlags,
  };
}

function responseHeaders(request: Request, cacheable = false): Headers {
  const headers = new Headers({
    'cache-control': cacheable
      ? 'public, max-age=0, must-revalidate'
      : 'no-store',
    'content-type': 'application/json; charset=utf-8',
    vary: 'Origin',
  });
  if (cacheable) {
    headers.set('cdn-cache-control', 'public, s-maxage=30, stale-while-revalidate=300');
  }
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set('access-control-allow-origin', origin);
  return headers;
}

function json(request: Request, data: unknown, status = 200, cacheable = false): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(request, cacheable),
  });
}

async function fetchAircraft(
  provider: string,
  endpoint: string,
): Promise<AircraftProbeResult> {
  const response = await fetch(endpoint, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Motion/1.0 (+https://github.com/mapzimus/Motion)',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`${provider} ${response.status}`);
  return { payload: (await response.json()) as AircraftPayload, provider };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json(request, { error: 'Origin not allowed' }, 403);
    }
    if (request.method === 'OPTIONS') {
      const headers = responseHeaders(request);
      headers.set('access-control-allow-methods', 'GET, OPTIONS');
      headers.set('access-control-max-age', '86400');
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET') return json(request, { error: 'Method not allowed' }, 405);

    const region = new URL(request.url).searchParams.get('region') ?? 'boston';
    if (!(region in PLANE_PROBES)) return json(request, { error: 'Unknown region' }, 400);

    const probes = PLANE_PROBES[region as RegionId];
    const primary = await Promise.allSettled(
      probes.map(({ lat, lon, radius }) =>
        fetchAircraft('ADSB.lol', `${ADSB_LOL_BASE}/${lat}/${lon}/${radius}`),
      ),
    );
    const results: Array<AircraftProbeResult | null> = primary.map((result) =>
      result.status === 'fulfilled' ? result.value : null,
    );
    const failures = primary.flatMap((result) =>
      result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
        : [],
    );

    for (let index = 0; index < probes.length; index += 1) {
      if (results[index]) continue;
      const { lat, lon, radius } = probes[index];
      try {
        results[index] = await fetchAircraft(
          'adsb.fi',
          `${ADSB_FI_BASE}/lat/${lat}/lon/${lon}/dist/${radius}`,
        );
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    const successful = results.filter((result): result is AircraftProbeResult => Boolean(result));
    if (!successful.length) {
      console.error('All aircraft providers failed', { region, failures });
      return json(request, { error: 'Aircraft providers unavailable', failures }, 502);
    }

    const unique = new Map<string, Record<string, unknown>>();
    for (const result of successful) {
      for (const aircraft of result.payload.ac ?? []) {
        const hex = String(aircraft.hex ?? '');
        if (hex) unique.set(hex, aircraft);
      }
    }

    const now = Date.now();
    const aircraft = [...unique.values()].flatMap((item) => {
      const normalized = normalizeAircraft(item, now);
      return normalized ? [normalized] : [];
    });

    const providers = [...new Set(successful.map((result) => result.provider))];
    return json(request, {
      provider: providers.join(' + '),
      region,
      aircraft,
      failedProbes: results.length - successful.length,
    }, 200, true);
  },
};
