// Chicago Transit Authority trains and buses. The CTA publishes no
// GTFS-realtime; its Train Tracker and Bus Tracker are JSON APIs behind free
// per-developer keys (docs/api-keys.md). Both are normalized here into the
// same RegionalVehicle shape as every GTFS-realtime feed.

import type { RegionalVehicle } from './feeds';

export const CTA_TRAIN_URL = 'https://lapi.transitchicago.com/api/1.0/ttpositions.aspx';
export const CTA_BUS_URL = 'https://www.ctabustracker.com/bustime/api/v2';

// Train Tracker route codes, their public names and the official line colors.
export const CTA_LINES: Record<string, { name: string; color: string }> = {
  red: { name: 'Red Line', color: '#c60c30' },
  blue: { name: 'Blue Line', color: '#00a1de' },
  brn: { name: 'Brown Line', color: '#62361b' },
  g: { name: 'Green Line', color: '#009b3a' },
  org: { name: 'Orange Line', color: '#f9461c' },
  p: { name: 'Purple Line', color: '#522398' },
  pink: { name: 'Pink Line', color: '#e27ea6' },
  y: { name: 'Yellow Line', color: '#f9e300' },
};

// Bus Tracker answers at most ten routes per call.
export const CTA_BUS_ROUTES_PER_CALL = 10;

function num(value: unknown): number | null {
  const converted = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(converted) ? converted : null;
}

// Train Tracker timestamps are local Chicago time, "2026-10-26T14:03:12".
// Bus Tracker uses "20261026 14:03" (or with seconds). Both are converted
// with the zone offset the feed header does not carry.
export function chicagoTimeToIso(value: string | undefined, offsetMinutes: number): string | null {
  if (!value) return null;
  const match = /^(\d{4})-?(\d{2})-?(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const utc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +(second ?? 0)) - offsetMinutes * 60_000;
  return new Date(utc).toISOString();
}

// Chicago is UTC-5 in daylight time, UTC-6 otherwise. DST runs from the second
// Sunday in March to the first Sunday in November (US rule since 2007).
export function chicagoOffsetMinutes(at = new Date()): number {
  const year = at.getUTCFullYear();
  const secondSundayMarch = new Date(Date.UTC(year, 2, 1 + ((7 - new Date(Date.UTC(year, 2, 1)).getUTCDay()) % 7) + 7, 7));
  const firstSundayNovember = new Date(Date.UTC(year, 10, 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7), 6));
  return at >= secondSundayMarch && at < firstSundayNovember ? -300 : -360;
}

type TrainRoute = { '@name'?: string; train?: Array<Record<string, unknown>> | Record<string, unknown> };

/** Normalizes a Train Tracker positions answer. */
export function ctaTrainVehicles(payload: unknown, now = new Date()): RegionalVehicle[] {
  const routes = (payload as { ctatt?: { route?: TrainRoute[] | TrainRoute } })?.ctatt?.route;
  const list = Array.isArray(routes) ? routes : routes ? [routes] : [];
  const offset = chicagoOffsetMinutes(now);
  return list.flatMap((route) => {
    const code = String(route['@name'] ?? '').toLowerCase();
    const line = CTA_LINES[code];
    if (!line) return [];
    const trains = Array.isArray(route.train) ? route.train : route.train ? [route.train] : [];
    return trains.flatMap((train) => {
      const lat = num(train.lat);
      const lng = num(train.lon);
      const run = String(train.rn ?? '');
      if (lat === null || lng === null || !run) return [];
      const heading = num(train.heading);
      const updatedAt = chicagoTimeToIso(String(train.prdt ?? ''), offset) ?? now.toISOString();
      return [{
        id: `cta-train-${code}-${run}`,
        feed: 'cta-train',
        agency: 'CTA',
        lng,
        lat,
        route: line.name,
        trip: '',
        label: run,
        bearing: heading,
        speedMps: null,
        updatedAt,
        headsign: train.destNm ? String(train.destNm) : undefined,
        color: line.color,
        positionSource: 'CTA Train Tracker',
      }];
    });
  });
}

/** Normalizes one Bus Tracker getvehicles answer. */
export function ctaBusVehicles(payload: unknown, now = new Date()): RegionalVehicle[] {
  const vehicles = (payload as { 'bustime-response'?: { vehicle?: Array<Record<string, unknown>> } })?.['bustime-response']?.vehicle;
  if (!Array.isArray(vehicles)) return [];
  const offset = chicagoOffsetMinutes(now);
  return vehicles.flatMap((bus) => {
    const lat = num(bus.lat);
    const lng = num(bus.lon);
    const vid = String(bus.vid ?? '');
    if (lat === null || lng === null || !vid) return [];
    return [{
      id: `cta-bus-${vid}`,
      feed: 'cta-bus',
      agency: 'CTA',
      lng,
      lat,
      route: String(bus.rt ?? ''),
      trip: String(bus.tatripid ?? ''),
      label: vid,
      bearing: num(bus.hdg),
      speedMps: null,
      updatedAt: chicagoTimeToIso(String(bus.tmstmp ?? ''), offset) ?? now.toISOString(),
      headsign: bus.des ? String(bus.des) : undefined,
      positionSource: 'CTA Bus Tracker',
    }];
  });
}

/** Route ids from a Bus Tracker getroutes answer. */
export function ctaBusRouteIds(payload: unknown): string[] {
  const routes = (payload as { 'bustime-response'?: { routes?: Array<{ rt?: string }> } })?.['bustime-response']?.routes;
  return Array.isArray(routes) ? routes.map((route) => String(route.rt ?? '')).filter(Boolean) : [];
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

const jsonHeaders = { accept: 'application/json' };

/** All eight lines in one Train Tracker call. */
export async function fetchCtaTrains(key: string): Promise<RegionalVehicle[]> {
  const url = `${CTA_TRAIN_URL}?key=${encodeURIComponent(key)}&rt=${Object.keys(CTA_LINES).join(',')}&outputType=JSON`;
  const response = await fetch(url, { headers: jsonHeaders, cf: { cacheEverything: true, cacheTtl: 30 } });
  if (!response.ok) throw new Error(`cta-train ${response.status}`);
  return ctaTrainVehicles(await response.json());
}

/**
 * Every CTA bus: the route list (cached an hour) then one getvehicles call
 * per ten routes. The caller caches the result for a couple of minutes so
 * the free key's daily allowance holds.
 */
export async function fetchCtaBuses(key: string): Promise<RegionalVehicle[]> {
  const routesResponse = await fetch(`${CTA_BUS_URL}/getroutes?key=${encodeURIComponent(key)}&format=json`, {
    headers: jsonHeaders,
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });
  if (!routesResponse.ok) throw new Error(`cta-bus routes ${routesResponse.status}`);
  const routeIds = ctaBusRouteIds(await routesResponse.json());
  const batches = await Promise.all(chunk(routeIds, CTA_BUS_ROUTES_PER_CALL).map(async (batch) => {
    const response = await fetch(
      `${CTA_BUS_URL}/getvehicles?key=${encodeURIComponent(key)}&rt=${batch.join(',')}&format=json`,
      { headers: jsonHeaders, cf: { cacheEverything: true, cacheTtl: 120 } },
    );
    if (!response.ok) return [];
    return ctaBusVehicles(await response.json());
  }));
  return batches.flat();
}
