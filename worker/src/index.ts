import { transit_realtime } from 'gtfs-realtime-bindings';
import { feedsForRegion, type TransitFeed } from './feeds';
import { AIS_BOUNDS, isRegionId, PLANE_PROBES, type RegionId } from './regions';

const ADSB_LOL_BASE = 'https://api.adsb.lol/v2/point';
const ADSB_FI_BASE = 'https://opendata.adsb.fi/api/v3';
const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const MASSDOT_WORK_ZONE_URL = 'https://feed.massdot-swzm.com/massdot_wzdx_v4.1_work_zone_feed.geojson';
const NORTHERN_WORK_ZONE_URL = 'https://api.dx.ne-compass.com/wzdx-latest/';
const IBI_TRAFFIC_TILE_URL = 'https://tiles.ibi511.com/Geoservice/GetTrafficTile';
const MASSDOT_CAMERA_URL = 'https://gis.massdot.state.ma.us/arcgis/rest/services/Assets/CCTV/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID%2CHOC_Display%2CRoadway%2CDirection%2CMM%2CMunicipality%2CDescription%2CStatus&returnGeometry=true&outSR=4326&f=geojson';
const IBI_511_SOURCES = [
  {
    key: 'north',
    base: 'https://newengland511.org',
    provider: 'New England 511 · MaineDOT / NHDOT / VTrans',
  },
  {
    key: 'ct',
    base: 'https://prod-ct.ibi511.com',
    provider: 'CTroads · Connecticut DOT',
  },
] as const;
const MNR_TRIP_UPDATES_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr';
const MNR_ALERTS_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fmnr-alerts';
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

const MNR_ROUTES: Record<string, { name: string; color: string }> = {
  '3': { name: 'New Haven', color: '#ee0034' },
  '4': { name: 'New Canaan', color: '#ee0034' },
  '5': { name: 'Danbury', color: '#ee0034' },
  '6': { name: 'Waterbury', color: '#ee0034' },
};

function translatedText(value: {
  translation?: Array<{ text?: string | null; language?: string | null }> | null;
} | null | undefined): string {
  return value?.translation?.find((entry) => entry.language === 'en')?.text ??
    value?.translation?.find((entry) => !entry.language?.includes('html'))?.text ??
    value?.translation?.[0]?.text ?? '';
}

function realtimeEventTime(update: {
  arrival?: { time?: unknown } | null;
  departure?: { time?: unknown } | null;
}): number | null {
  return numberValue(update.departure?.time) ?? numberValue(update.arrival?.time);
}

function mnrAlertSeverity(text: string): number {
  if (/suspend|no service|cancel/i.test(text)) return 8;
  if (/delay|late|reduced|modified|replacement bus/i.test(text)) return 6;
  return 4;
}

async function metroNorth(request: Request, ctx: ExecutionContext): Promise<Response> {
  return cachedJson(request, ctx, 15, async () => {
    const [tripsResponse, alertsResponse] = await Promise.all([
      fetch(MNR_TRIP_UPDATES_URL, {
        headers: { accept: 'application/x-protobuf' },
        cf: { cacheEverything: true, cacheTtl: 15 },
      }),
      fetch(MNR_ALERTS_URL, {
        headers: { accept: 'application/x-protobuf' },
        cf: { cacheEverything: true, cacheTtl: 30 },
      }),
    ]);
    if (!tripsResponse.ok) return json({ error: `MTA Metro-North trip updates ${tripsResponse.status}` }, 502);
    if (!alertsResponse.ok) return json({ error: `MTA Metro-North alerts ${alertsResponse.status}` }, 502);

    const tripMessage = transit_realtime.FeedMessage.decode(
      new Uint8Array(await tripsResponse.arrayBuffer()),
    );
    const alertMessage = transit_realtime.FeedMessage.decode(
      new Uint8Array(await alertsResponse.arrayBuffer()),
    );
    const feedTimestamp = numberValue(tripMessage.header.timestamp) ?? Math.floor(Date.now() / 1000);

    const trips = tripMessage.entity.flatMap((entity) => {
      const update = entity.tripUpdate;
      const routeId = update?.trip?.routeId ?? '';
      const route = MNR_ROUTES[routeId];
      if (!update || !route) return [];
      const timedStops = (update.stopTimeUpdate ?? []).flatMap((stop) => {
        const time = realtimeEventTime(stop);
        return time === null || !stop.stopId ? [] : [{ stopId: stop.stopId, time }];
      });
      if (timedStops.length < 2) return [];

      let previousIndex = -1;
      for (let index = 0; index < timedStops.length; index += 1) {
        if (timedStops[index].time <= feedTimestamp) previousIndex = index;
        else break;
      }
      if (previousIndex < 0 || previousIndex >= timedStops.length - 1) return [];
      const previous = timedStops[previousIndex];
      const next = timedStops[previousIndex + 1];
      const duration = Math.max(1, next.time - previous.time);
      const progress = Math.max(0, Math.min(1, (feedTimestamp - previous.time) / duration));
      const label = entity.vehicle?.vehicle?.label || entity.vehicle?.vehicle?.id || entity.id;
      return [{
        id: entity.id,
        tripId: update.trip?.tripId ?? '',
        label,
        routeId,
        routeName: route.name,
        color: route.color,
        previousStopId: previous.stopId,
        previousTime: previous.time,
        nextStopId: next.stopId,
        nextTime: next.time,
        destinationStopId: timedStops.at(-1)?.stopId ?? next.stopId,
        progress,
        updatedAt: new Date(feedTimestamp * 1000).toISOString(),
      }];
    });

    const alertNow = numberValue(alertMessage.header.timestamp) ?? feedTimestamp;
    const alerts = alertMessage.entity.flatMap((entity) => {
      const alert = entity.alert;
      if (!alert) return [];
      const activePeriods = alert.activePeriod ?? [];
      const informedEntities = alert.informedEntity ?? [];
      const active = !activePeriods.length || activePeriods.some((period) => {
        const start = numberValue(period.start) ?? 0;
        const end = numberValue(period.end);
        return start <= alertNow && (end === null || end >= alertNow);
      });
      if (!active) return [];
      const allRouteIds = [...new Set(
        informedEntities.map((item) => item.routeId).filter((routeId): routeId is string => Boolean(routeId)),
      )];
      const routeIds = allRouteIds.filter((routeId) => Boolean(MNR_ROUTES[routeId]));
      if (allRouteIds.length && !routeIds.length) return [];
      const header = translatedText(alert.headerText);
      if (!header) return [];
      return [{
        id: entity.id,
        effect: 'Metro-North',
        severity: mnrAlertSeverity(header),
        header,
        description: translatedText(alert.descriptionText),
        routes: routeIds.map((routeId) => `metro-north:${routeId}`),
        stopIds: [...new Set(
          informedEntities.map((item) => item.stopId).filter((stopId): stopId is string => Boolean(stopId)),
        )],
      }];
    });

    return json({
      provider: 'MTA Metro-North GTFS-Realtime',
      positioning: 'estimated-between-stations',
      updatedAt: new Date(feedTimestamp * 1000).toISOString(),
      trips,
      alerts,
    });
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
      description?: string;
    };
    start_date?: string;
    end_date?: string;
    vehicle_impact?: string;
    lanes?: Array<{ status?: string; type?: string }>;
    restrictions?: Array<Record<string, unknown>>;
    types_of_work?: Array<{ type_name?: string }>;
  };
};

type WorkZoneCollection = {
  features?: WorkZoneFeature[];
  road_event_feed_info?: { update_date?: string };
  feed_info?: { update_date?: string };
};

function workZoneProvider(feature: WorkZoneFeature, fallback: string): string {
  const id = String(feature.id ?? '');
  if (/^VT/i.test(id)) return 'VTrans · New England 511 WZDx';
  if (/^NH/i.test(id)) return 'NHDOT · New England 511 WZDx';
  if (/^ME/i.test(id)) return 'MaineDOT · New England 511 WZDx';
  return fallback;
}

function validIso(value: string | undefined, fallback: string): string {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) && timestamp > Date.UTC(2000, 0, 1)
    ? new Date(timestamp).toISOString()
    : fallback;
}

function normalizeWorkZones(
  source: WorkZoneCollection,
  fallbackProvider: string,
  sourceUrl: string,
): Array<Record<string, unknown>> {
  const now = Date.now();
  const horizon = now + 7 * 24 * 60 * 60 * 1000;
  const feedUpdatedAt = validIso(
    source.road_event_feed_info?.update_date ?? source.feed_info?.update_date,
    new Date().toISOString(),
  );
  return (source.features ?? []).flatMap((feature) => {
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
    const closedLanes = (properties?.lanes ?? []).filter((lane) => lane.status === 'closed');
    const laneText = closedLanes.length
      ? `${closedLanes.length} closed lane${closedLanes.length === 1 ? '' : 's'}`
      : '';
    const workTypes = (properties?.types_of_work ?? [])
      .map((work) => work.type_name?.replace(/-/g, ' '))
      .filter(Boolean)
      .join(', ');
    const color = impact.includes('all-lanes-closed')
      ? '#ff5c5c'
      : impact.includes('some') || impact.includes('reduced')
        ? '#ffb454'
        : '#ff8a4c';
    const provider = workZoneProvider(feature, fallbackProvider);
    return [{
      type: 'Feature',
      id: feature.id,
      geometry,
      properties: {
        group: 'roadwork',
        dataStatus: 'live',
        color,
        active,
        title: roadNames.join(' / ') || 'Official work zone',
        status: [direction, impactText, laneText].filter(Boolean).join(' · '),
        details: properties?.core_details?.description ?? '',
        workTypes,
        provider,
        sourceUrl,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        updatedAt: validIso(properties?.core_details?.update_date, feedUpdatedAt),
      },
    }];
  });
}

async function roadwork(request: Request, ctx: ExecutionContext): Promise<Response> {
  return cachedJson(request, ctx, 60, async () => {
    const settled = await Promise.allSettled([
      fetch(MASSDOT_WORK_ZONE_URL, {
        headers: { accept: 'application/geo+json, application/json' },
        cf: { cacheEverything: true, cacheTtl: 60 },
      }),
      fetch(NORTHERN_WORK_ZONE_URL, {
        headers: { accept: 'application/geo+json, application/json' },
        cf: { cacheEverything: true, cacheTtl: 60 },
      }),
    ]);
    const inputs: Array<{ source: WorkZoneCollection; provider: string; sourceUrl: string }> = [];
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      if (result.status !== 'fulfilled' || !result.value.ok) continue;
      inputs.push({
        source: await result.value.json() as WorkZoneCollection,
        provider: index === 0 ? 'MassDOT Connected Work Zones' : 'New England 511 WZDx',
        sourceUrl: index === 0 ? MASSDOT_WORK_ZONE_URL : NORTHERN_WORK_ZONE_URL,
      });
    }
    if (!inputs.length) return json({ error: 'Official work-zone feeds unavailable' }, 502);
    const features = inputs.flatMap((input) =>
      normalizeWorkZones(input.source, input.provider, input.sourceUrl),
    );
    return json({
      type: 'FeatureCollection',
      provider: 'MassDOT + MaineDOT + NHDOT + VTrans WZDx',
      coverage: ['ma', 'me', 'nh', 'vt'],
      features,
    });
  });
}

type IbiIcon = { itemId?: string; location?: [number, number] };
type IbiIcons = { item2?: IbiIcon[] };

function decodeHtml(value: string): string {
  const entities: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#39': "'",
  };
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&([a-z]+|#\d+);/gi, (match, key) => {
      if (key.startsWith('#')) return String.fromCharCode(Number(key.slice(1)));
      return entities[key.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlCell(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<th[^>]*>\\s*${escaped}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}

async function incidentFeature(source: typeof IBI_511_SOURCES[number], icon: IbiIcon) {
  const id = String(icon.itemId ?? '');
  const location = icon.location;
  if (!/^\d+$/.test(id) || !location || location.length !== 2) return null;
  const detailUrl = `${source.base}/Event/Incidents/${id}?lang=en`;
  let description = '';
  let startAt = '';
  let endAt = '';
  let updatedAt = new Date().toISOString();
  try {
    const response = await fetch(`${source.base}/tooltip/Incidents/${id}?lang=en`, {
      cf: { cacheEverything: true, cacheTtl: 60 },
    });
    if (response.ok) {
      const html = await response.text();
      const descriptionMatch = html.match(/<td[^>]*colspan=["']?2["']?[^>]*>([\s\S]*?)<\/td>/i);
      description = descriptionMatch ? decodeHtml(descriptionMatch[1]) : '';
      startAt = htmlCell(html, 'Start Time');
      endAt = htmlCell(html, 'Anticipated End Time');
      const lastUpdated = htmlCell(html, 'Last Updated');
      const parsed = Date.parse(lastUpdated || startAt);
      if (Number.isFinite(parsed)) updatedAt = new Date(parsed).toISOString();
    }
  } catch {
    // The point and official detail link are still useful if tooltip markup changes.
  }
  return {
    type: 'Feature',
    id: `${source.key}-${id}`,
    geometry: { type: 'Point', coordinates: [Number(location[1]), Number(location[0])] },
    properties: {
      group: 'incident',
      dataStatus: 'live',
      color: '#ff5c5c',
      title: description || 'Official 511 road incident',
      status: [startAt && `Started ${startAt}`, endAt && `Expected through ${endAt}`].filter(Boolean).join(' · '),
      details: description,
      provider: source.provider,
      sourceUrl: detailUrl,
      updatedAt,
    },
  };
}

async function roadEvents(request: Request, ctx: ExecutionContext): Promise<Response> {
  return cachedJson(request, ctx, 60, async () => {
    const feeds = await Promise.allSettled(
      IBI_511_SOURCES.map(async (source) => {
        const response = await fetch(`${source.base}/map/mapIcons/Incidents`, {
          headers: { accept: 'application/json' },
          cf: { cacheEverything: true, cacheTtl: 60 },
        });
        if (!response.ok) throw new Error(`${source.key} incidents ${response.status}`);
        const icons = await response.json() as IbiIcons;
        return Promise.all((icons.item2 ?? []).map((icon) => incidentFeature(source, icon)));
      }),
    );
    const features = feeds.flatMap((result) =>
      result.status === 'fulfilled' ? result.value.filter(Boolean) : [],
    );
    if (!features.length && feeds.every((result) => result.status === 'rejected')) {
      return json({ error: 'Official 511 incident feeds unavailable' }, 502);
    }
    return json({
      type: 'FeatureCollection',
      provider: 'Official 511 incident feeds',
      coverage: ['ct', 'me', 'nh', 'vt'],
      features,
    });
  });
}

async function cameras(request: Request, ctx: ExecutionContext): Promise<Response> {
  return cachedJson(request, ctx, 5 * 60, async () => {
    const [ibiResult, massResult] = await Promise.allSettled([
      Promise.all(IBI_511_SOURCES.map(async (source) => {
        const response = await fetch(`${source.base}/map/mapIcons/Cameras`, {
          headers: { accept: 'application/json' },
          cf: { cacheEverything: true, cacheTtl: 5 * 60 },
        });
        if (!response.ok) throw new Error(`${source.key} cameras ${response.status}`);
        const icons = await response.json() as IbiIcons;
        return (icons.item2 ?? []).flatMap((icon) => {
          const id = String(icon.itemId ?? '');
          const location = icon.location;
          if (!/^\d+$/.test(id) || !location || location.length !== 2) return [];
          return [{
            type: 'Feature',
            id: `${source.key}-${id}`,
            geometry: { type: 'Point', coordinates: [Number(location[1]), Number(location[0])] },
            properties: {
              group: 'camera',
              dataStatus: 'live',
              color: '#d2d7dd',
              title: 'Official traffic camera',
              status: 'Click to load the latest public image',
              provider: source.provider,
              providerKey: source.key,
              cameraId: id,
              sourceUrl: `${source.base}/`,
              updatedAt: new Date().toISOString(),
            },
          }];
        });
      })),
      fetch(MASSDOT_CAMERA_URL, {
        headers: { accept: 'application/geo+json, application/json' },
        cf: { cacheEverything: true, cacheTtl: 24 * 60 * 60 },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`MassDOT cameras ${response.status}`);
        return response.json() as Promise<{ features?: Array<{
          id?: string | number;
          geometry?: { type?: string; coordinates?: unknown };
          properties?: Record<string, unknown>;
        }> }>;
      }),
    ]);

    const ibiFeatures = ibiResult.status === 'fulfilled' ? ibiResult.value.flat() : [];
    const massFeatures = massResult.status === 'fulfilled'
      ? (massResult.value.features ?? []).flatMap((feature) => {
        if (feature.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return [];
        const p = feature.properties ?? {};
        const roadway = p.Roadway ? `Route ${p.Roadway}` : '';
        const direction = String(p.Direction ?? '');
        const mile = p.MM !== null && p.MM !== undefined ? `mile ${p.MM}` : '';
        return [{
          type: 'Feature',
          id: `ma-${feature.id ?? p.OBJECTID}`,
          geometry: feature.geometry,
          properties: {
            group: 'camera',
            dataStatus: 'live',
            color: '#d2d7dd',
            title: String(p.HOC_Display ?? p.Description ?? 'MassDOT traffic camera'),
            status: [roadway, direction, mile, p.Status].filter(Boolean).join(' · '),
            details: 'MassDOT publishes the camera location; open Mass511 for the public viewer.',
            provider: 'MassDOT CCTV asset inventory',
            sourceUrl: 'https://www.mass511.com/',
            updatedAt: new Date().toISOString(),
          },
        }];
      })
      : [];
    const features = [...ibiFeatures, ...massFeatures];
    if (!features.length) return json({ error: 'Official camera sources unavailable' }, 502);
    return json({
      type: 'FeatureCollection',
      provider: 'Official New England traffic camera sources',
      coverage: ['ct', 'ma', 'me', 'nh', 'vt'],
      features,
    });
  });
}

async function cameraDetail(url: URL): Promise<Response> {
  const providerKey = url.searchParams.get('provider');
  const id = url.searchParams.get('id') ?? '';
  const source = IBI_511_SOURCES.find((item) => item.key === providerKey);
  if (!source || !/^\d+$/.test(id)) return json({ error: 'Invalid camera request' }, 400);
  const upstream = await fetch(`${source.base}/tooltip/Cameras/${id}?lang=en`, {
    cf: { cacheEverything: true, cacheTtl: 30 },
  });
  if (!upstream.ok) return json({ error: `Camera detail ${upstream.status}` }, 502);
  const html = await upstream.text();
  const titleMatch = html.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
  const imageMatch = html.match(/data-lazy=["']([^"']+)["']/i);
  const directionMatch = html.match(/class=["']dirDescHeader["'][^>]*>([\s\S]*?)<\/div>/i);
  return json({
    title: titleMatch ? decodeHtml(titleMatch[1]) : 'Official traffic camera',
    direction: directionMatch ? decodeHtml(directionMatch[1]) : '',
    imageUrl: imageMatch ? new URL(imageMatch[1], source.base).toString() : '',
    sourceUrl: `${source.base}/`,
    provider: source.provider,
    updatedAt: new Date().toISOString(),
  });
}

async function trafficTile(
  request: Request,
  path: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const match = path.match(/^\/api\/traffic\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (!match) return json({ error: 'Invalid traffic tile path' }, 400);
  const [z, x, y] = match.slice(1).map(Number);
  const limit = 2 ** z;
  if (z > 22 || x >= limit || y >= limit) return json({ error: 'Invalid traffic tile coordinates' }, 400);

  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const tomtomKey = secret(env, 'TOMTOM_API_KEY');
  const target = configured(tomtomKey)
    ? `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png?key=${encodeURIComponent(tomtomKey ?? '')}&thickness=10`
    : `${IBI_TRAFFIC_TILE_URL}?x=${x}&y=${y}&z=${z}`;
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
          metroNorth: true,
          roadwork: true,
          roadEvents: true,
          cameras: true,
          ais: configured(secret(env, 'AISSTREAM_API_KEY')),
          traffic: true,
          swiftly: configured(secret(env, 'SWIFTLY_API_KEY')),
        },
      });
    } else if (url.pathname === '/api/planes') {
      response = await planes(request, url, ctx);
    } else if (url.pathname === '/api/transit') {
      response = await transit(request, url, env, ctx);
    } else if (url.pathname === '/api/mnr') {
      response = await metroNorth(request, ctx);
    } else if (url.pathname === '/api/roadwork') {
      response = await roadwork(request, ctx);
    } else if (url.pathname === '/api/road-events') {
      response = await roadEvents(request, ctx);
    } else if (url.pathname === '/api/cameras') {
      response = await cameras(request, ctx);
    } else if (url.pathname === '/api/camera-detail') {
      response = await cameraDetail(url);
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
