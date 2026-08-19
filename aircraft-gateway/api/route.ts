const ALLOWED_ORIGINS = new Set([
  'https://mapzimus.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

type RouteAirport = {
  name?: string;
  icao?: string;
  iata?: string;
  location?: string;
  countryiso2?: string;
};

function headers(request: Request, cacheSeconds: number): Headers {
  const result = new Headers({
    'cache-control': 'public, max-age=0, must-revalidate',
    'cdn-cache-control': `public, s-maxage=${cacheSeconds}, stale-while-revalidate=604800`,
    'content-type': 'application/json; charset=utf-8',
    vary: 'Origin',
  });
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) result.set('access-control-allow-origin', origin);
  return result;
}

function json(request: Request, data: unknown, status = 200, cacheSeconds = 86_400): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: headers(request, cacheSeconds),
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json(request, { error: 'Origin not allowed' }, 403, 0);
    if (request.method === 'OPTIONS') {
      const responseHeaders = headers(request, 0);
      responseHeaders.set('access-control-allow-methods', 'GET, OPTIONS');
      responseHeaders.set('access-control-max-age', '86400');
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    if (request.method !== 'GET') return json(request, { error: 'Method not allowed' }, 405, 0);

    const callsign = (new URL(request.url).searchParams.get('callsign') ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,8}$/.test(callsign)) return json(request, { error: 'Invalid callsign' }, 400, 0);

    const prefix = callsign.slice(0, 2);
    const upstream = await fetch(
      `https://vrs-standing-data.adsb.lol/routes/${prefix}/${callsign}.json`,
      { signal: AbortSignal.timeout(6_000) },
    );
    if (upstream.status === 404) return json(request, { error: 'Route unavailable' }, 404, 14_400);
    if (!upstream.ok) return json(request, { error: `Route provider ${upstream.status}` }, 502, 60);
    const route = await upstream.json() as { _airports?: RouteAirport[] };
    const airports = (route._airports ?? []).map((airport) => ({
      name: airport.name ?? '',
      icao: airport.icao ?? '',
      iata: airport.iata ?? '',
      location: airport.location ?? '',
      country: airport.countryiso2 ?? '',
    }));
    if (airports.length < 2) return json(request, { error: 'Route unavailable' }, 404, 14_400);
    return json(request, { callsign, airports, source: 'ADSB.lol route catalog' });
  },
};
