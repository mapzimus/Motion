import { transit_realtime } from 'gtfs-realtime-bindings';
import { feedsForRegion, type TransitFeed } from './feeds';
import { AIS_BOUNDS, isRegionId, PLANE_PROBES, type RegionId } from './regions';

const ADSB_LOL_BASE = 'https://api.adsb.lol/v2/point';
const ADSB_FI_BASE = 'https://opendata.adsb.fi/api/v3';
const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const MASSDOT_WORK_ZONE_URL = 'https://feed.massdot-swzm.com/massdot_wzdx_v4.1_work_zone_feed.geojson';
const NEW_ENGLAND_BBOX = { west: -74, south: 40.8, east: -66, north: 47.7 };
const PLANE_STALE_TTL_SECONDS = 5 * 60;

type JsonValue = Record<string, unknown> | unknown[];

function json(data: JsonValue, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers });
}

function configured(value: string | undefined): boolean {
  return Boolean(value && !value.includes('placeholder') && !value.startsWith('replace-'));
}

function secret(env: Env, name: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[name];
}

function requestOriginAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).includes(origin);
}

function withCors(response: Response, request: Request): Response {
  const origin = request.headers.get('origin');
  const headers = new Headers(response.headers);
  if (origin) headers.set('access-control-allow-origin', origin);
  headers.set('vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function preflight(request: Request): Response {
  const origin = request.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: {
      ...(origin ? { 'access-control-allow-origin': origin } : {}),
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'Origin',
    },
  });
}

async function cachedJson(
  request: Request,
  ctx: ExecutionContext,
  ttlSeconds: number,
  producer: () => Promise<Response>,
): Promise<Response> {
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const response = await producer();
  if (response.ok) {
    const cacheable = new Response(response.body, response);
    cacheable.headers.set('cache-control', `public, max-age=${ttlSeconds}`);
    ctx.waitUntil(caches.default.put(cacheKey, cacheable.clone()));
    return cacheable;
  }
  return response;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toNumber' in value) {
    const converted = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(converted) ? converted : null;
  }
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function regionFrom(url: URL): RegionId | null {
  const region = url.searchParams.get('region') ?? 'boston';
  return isRegionId(region) ? region : null;
}

type AircraftPayload = { ac?: Array<Record<string, unknown>> };
type AircraftProbeResult = { payload: AircraftPayload; provider: string };

async function fetchAircraft(
  provider: string,
  endpoint: string,
  cacheTtl: number,
): Promise<AircraftProbeResult> {
  const upstream = await fetch(endpoint, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Motion/0.5 (+https://github.com/mapzimus/Motion)',
    },
    cf: { cacheEverything: true, cacheTtl },
  });
  if (!upstream.ok) throw new Error(`${provider} ${upstream.status}`);
  return { payload: (await upstream.json()) as AircraftPayload, provider };
}

async function planes(request: Request, url: URL, ctx: ExecutionContext): Promise<Response> {
  const region = regionFrom(url);
  if (!region) return json({ error: 'Unknown region' }, 400);

  const staleCacheKey = new Request(
    `${url.origin}${url.pathname}?region=${region}&cache=last-good`,
    { method: 'GET' },
  );

  return cachedJson(request, ctx, 15, async () => {
    const probes = PLANE_PROBES[region];
    const primary = await Promise.allSettled(
      probes.map(({ lat, lon, radius }) =>
        fetchAircraft('ADSB.lol', `${ADSB_LOL_BASE}/${lat}/${lon}/${radius}`, 15),
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

    // adsb.fi permits one public request per second. Only failed ADSB.lol probes
    // fall back, and multi-probe regions are serialized to respect that limit.
    let fallbackRequests = 0;
    for (let index = 0; index < probes.length; index += 1) {
      if (results[index]) continue;
      if (fallbackRequests > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1_050));
      }
      fallbackRequests += 1;
      const { lat, lon, radius } = probes[index];
      try {
        results[index] = await fetchAircraft(
          'adsb.fi',
          `${ADSB_FI_BASE}/lat/${lat}/lon/${lon}/dist/${radius}`,
          45,
        );
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        // A last-known-good response below covers short outages of both feeds.
      }
    }

    const successful = results.filter((result): result is AircraftProbeResult => Boolean(result));
    if (!successful.length) {
      const stale = await caches.default.match(staleCacheKey);
      if (stale) {
        const response = new Response(stale.body, stale);
        response.headers.set('x-motion-data', 'last-good');
        return response;
      }
      return json({ error: 'Aircraft providers unavailable', failures }, 502);
    }

    const unique = new Map<string, Record<string, unknown>>();
    for (const result of successful) {
      for (const aircraft of result.payload.ac ?? []) {
        const hex = String(aircraft.hex ?? '');
        if (hex) unique.set(hex, aircraft);
      }
    }

    const aircraft = [...unique.values()].flatMap((item) => {
      const lat = numberValue(item.lat);
      const lng = numberValue(item.lon);
      if (lat === null || lng === null) return [];
      const seenSeconds = numberValue(item.seen) ?? 0;
      return [{
        id: String(item.hex),
        lng,
        lat,
        callsign: String(item.flight ?? '').trim(),
        aircraftType: String(item.t ?? ''),
        bearing: numberValue(item.track),
        altitudeFeet: item.alt_baro === 'ground' ? null : numberValue(item.alt_baro),
        groundSpeedKnots: numberValue(item.gs),
        onGround: item.alt_baro === 'ground',
        updatedAt: new Date(Date.now() - seenSeconds * 1000).toISOString(),
      }];
    });

    const providers = [...new Set(successful.map((result) => result.provider))];
    const response = json({
      provider: providers.join(' + '),
      region,
      aircraft,
      failedProbes: results.length - successful.length,
    });
    const lastGood = response.clone();
    lastGood.headers.set('cache-control', `public, max-age=${PLANE_STALE_TTL_SECONDS}`);
    ctx.waitUntil(caches.default.put(staleCacheKey, lastGood));
    return response;
  });
}

function insideNewEngland(lng: number, lat: number): boolean {
  return lng >= NEW_ENGLAND_BBOX.west && lng <= NEW_ENGLAND_BBOX.east &&
    lat >= NEW_ENGLAND_BBOX.south && lat <= NEW_ENGLAND_BBOX.north;
}

async function readTransitFeed(feed: TransitFeed, env: Env) {
  const swiftlyKey = secret(env, 'SWIFTLY_API_KEY');
  if (feed.authorization === 'swiftly' && !configured(swiftlyKey)) {
    return { feed: feed.id, agency: feed.agency, state: 'needs-key' as const, vehicles: [] };
  }

  const headers = new Headers({ accept: 'application/x-protobuf' });
  if (feed.authorization === 'swiftly') headers.set('authorization', swiftlyKey ?? '');
  const upstream = await fetch(feed.url, {
    headers,
    cf: { cacheEverything: true, cacheTtl: 15 },
  });
  if (!upstream.ok) throw new Error(`${feed.id} ${upstream.status}`);

  const message = transit_realtime.FeedMessage.decode(new Uint8Array(await upstream.arrayBuffer()));
  const headerTimestamp = numberValue(message.header.timestamp);
  const vehicles = message.entity.flatMap((entity) => {
    const vehicle = entity.vehicle;
    const position = vehicle?.position;
    const lat = numberValue(position?.latitude);
    const lng = numberValue(position?.longitude);
    if (lat === null || lng === null || !insideNewEngland(lng, lat)) return [];

    const timestamp = numberValue(vehicle?.timestamp) ?? headerTimestamp;
    const vehicleId = vehicle?.vehicle?.id || vehicle?.vehicle?.label || entity.id;
    return [{
      id: `${feed.id}-${vehicleId}`,
      feed: feed.id,
      agency: feed.agency,
      lng,
      lat,
      route: vehicle?.trip?.routeId ?? '',
      trip: vehicle?.trip?.tripId ?? '',
      label: vehicle?.vehicle?.label ?? vehicle?.vehicle?.id ?? '',
      bearing: numberValue(position?.bearing),
      speedMps: numberValue(position?.speed),
      updatedAt: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
    }];
  });

  return { feed: feed.id, agency: feed.agency, state: 'live' as const, vehicles };
}

async function transit(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const region = regionFrom(url);
  if (!region) return json({ error: 'Unknown region' }, 400);

  return cachedJson(request, ctx, 15, async () => {
    const feeds = feedsForRegion(region);
    const settled = await Promise.allSettled(feeds.map((feed) => readTransitFeed(feed, env)));
    const feedStatus = settled.map((result, index) =>
      result.status === 'fulfilled'
        ? { feed: result.value.feed, agency: result.value.agency, state: result.value.state, count: result.value.vehicles.length }
        : { feed: feeds[index].id, agency: feeds[index].agency, state: 'error', count: 0 },
    );
    const vehicles = settled.flatMap((result) =>
      result.status === 'fulfilled' ? result.value.vehicles : [],
    );
    return json({ region, vehicles, feeds: feedStatus });
  });
}

type WorkZoneFeature = {
  id?: string;
  type?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    core_details?: {
      road_names?: string[];
      direction?: string;
      update_date?: string;
    };
    start_date?: string;
    end_date?: string;
    vehicle_impact?: string;
  };
};

async function roadwork(request: Request, ctx: ExecutionContext): Promise<Response> {
  return cachedJson(request, ctx, 60, async () => {
    const upstream = await fetch(MASSDOT_WORK_ZONE_URL, {
      headers: { accept: 'application/geo+json, application/json' },
      cf: { cacheEverything: true, cacheTtl: 60 },
    });
    if (!upstream.ok) return json({ error: `MassDOT work-zone feed ${upstream.status}` }, 502);
    const source = await upstream.json() as { features?: WorkZoneFeature[] };
    const now = Date.now();
    const horizon = now + 24 * 60 * 60 * 1000;
    const features = (source.features ?? []).flatMap((feature) => {
      const properties = feature.properties;
      const geometry = feature.geometry;
      const startAt = Date.parse(properties?.start_date ?? '');
      const endAt = Date.parse(properties?.end_date ?? '');
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return [];
      if (endAt < now - 15 * 60_000 || startAt > horizon) return [];
      if (!geometry?.coordinates || !['LineString', 'MultiLineString'].includes(geometry.type ?? '')) return [];

      const active = startAt <= now && endAt >= now;
      const impact = properties?.vehicle_impact ?? 'unknown-impact';
      const direction = properties?.core_details?.direction?.replace(/-/g, ' ') ?? '';
      const impactText = impact.replace(/-/g, ' ');
      const roadNames = properties?.core_details?.road_names?.filter(Boolean) ?? [];
      const color = impact.includes('closed')
        ? '#ef5b5b'
        : impact.includes('some') || impact.includes('reduced')
          ? '#ffb454'
          : '#ff8a4c';
      return [{
        type: 'Feature',
        id: feature.id,
        geometry,
        properties: {
          group: 'roadwork',
          color,
          active,
          title: roadNames.join(' / ') || 'MassDOT work zone',
          status: [direction, impactText].filter(Boolean).join(' · '),
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          updatedAt: properties?.core_details?.update_date ?? new Date().toISOString(),
        },
      }];
    });
    return json({
      type: 'FeatureCollection',
      provider: 'MassDOT Connected Work Zones',
      coverage: ['ma'],
      features,
    });
  });
}

async function trafficTile(
  request: Request,
  path: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const tomtomKey = secret(env, 'TOMTOM_API_KEY');
  if (!configured(tomtomKey)) return json({ error: 'Traffic key is not configured' }, 503);
  const match = path.match(/^\/api\/traffic\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (!match) return json({ error: 'Invalid traffic tile path' }, 400);
  const [z, x, y] = match.slice(1).map(Number);
  const limit = 2 ** z;
  if (z > 22 || x >= limit || y >= limit) return json({ error: 'Invalid traffic tile coordinates' }, 400);

  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const target = `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png?key=${encodeURIComponent(tomtomKey ?? '')}&thickness=10`;
  const upstream = await fetch(target, { cf: { cacheEverything: true, cacheTtl: 60 } });
  if (!upstream.ok) return json({ error: `Traffic provider ${upstream.status}` }, 502);

  const response = new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'image/png',
      'cache-control': 'public, max-age=60',
    },
  });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

function ais(request: Request, url: URL, env: Env): Response {
  const aisKey = secret(env, 'AISSTREAM_API_KEY');
  if (!configured(aisKey)) return json({ error: 'AIS key is not configured' }, 503);
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'Expected a WebSocket upgrade' }, 426, { upgrade: 'websocket' });
  }
  const region = regionFrom(url);
  if (!region) return json({ error: 'Unknown region' }, 400);

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  const upstream = new WebSocket(AISSTREAM_URL);

  const closeServer = (code: number, reason: string) => {
    try {
      server.close(code, reason.slice(0, 120));
    } catch {
      // Already closed.
    }
  };

  upstream.addEventListener('open', () => {
    upstream.send(JSON.stringify({
      APIKey: aisKey,
      BoundingBoxes: [AIS_BOUNDS[region]],
      FilterMessageTypes: [
        'PositionReport',
        'StandardClassBPositionReport',
        'ExtendedClassBPositionReport',
        'ShipStaticData',
      ],
    }));
  });
  upstream.addEventListener('message', (event) => {
    if (server.readyState === 1) server.send(event.data);
  });
  upstream.addEventListener('close', (event) => closeServer(event.code || 1012, 'AIS upstream closed'));
  upstream.addEventListener('error', () => closeServer(1011, 'AIS upstream error'));
  server.addEventListener('close', () => upstream.close(1000, 'Browser disconnected'));
  server.addEventListener('error', () => upstream.close(1011, 'Browser socket error'));

  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (!requestOriginAllowed(request, env)) return json({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return preflight(request);
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET, OPTIONS' });

    const url = new URL(request.url);
    let response: Response;
    if (url.pathname === '/health') {
      response = json({
        service: 'Motion gateway',
        status: 'ok',
        providers: {
          aircraft: true,
          regionalTransit: true,
          roadwork: true,
          ais: configured(secret(env, 'AISSTREAM_API_KEY')),
          traffic: configured(secret(env, 'TOMTOM_API_KEY')),
          swiftly: configured(secret(env, 'SWIFTLY_API_KEY')),
        },
      });
    } else if (url.pathname === '/api/planes') {
      response = await planes(request, url, ctx);
    } else if (url.pathname === '/api/transit') {
      response = await transit(request, url, env, ctx);
    } else if (url.pathname === '/api/roadwork') {
      response = await roadwork(request, ctx);
    } else if (url.pathname.startsWith('/api/traffic/')) {
      response = await trafficTile(request, url.pathname, env, ctx);
    } else if (url.pathname === '/api/ais') {
      return ais(request, url, env);
    } else {
      response = json({ error: 'Not found' }, 404);
    }
    return withCors(response, request);
  },
} satisfies ExportedHandler<Env>;
