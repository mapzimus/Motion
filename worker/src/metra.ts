// Metra's GTFS API (gtfsapi.metrarr.com) serves the realtime entities as JSON
// instead of protobuf, behind HTTP basic auth with the developer's access key
// and secret (docs/api-keys.md). Field names follow the protobuf schema in
// snake_case; a camelCase variant is accepted too.

import type { RegionalVehicle } from './feeds';

type Long = { low?: number; high?: number } | number | string | null | undefined;

function num(value: unknown): number | null {
  if (value && typeof value === 'object') {
    const long = value as { low?: number; high?: number };
    if (typeof long.low === 'number') return (long.high ?? 0) * 4294967296 + (long.low >>> 0);
    return null;
  }
  const converted = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function pick(record: Record<string, unknown> | undefined, snake: string, camel: string): unknown {
  return record?.[snake] ?? record?.[camel];
}

export function metraVehicles(payload: unknown, now = new Date()): RegionalVehicle[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entity) => {
    const vehicle = (entity as { vehicle?: Record<string, unknown> })?.vehicle;
    const position = vehicle?.position as Record<string, unknown> | undefined;
    const trip = vehicle?.trip as Record<string, unknown> | undefined;
    const descriptor = vehicle?.vehicle as Record<string, unknown> | undefined;
    const lat = num(position?.latitude);
    const lng = num(position?.longitude);
    if (lat === null || lng === null) return [];
    const id = String(descriptor?.id ?? descriptor?.label ?? (entity as { id?: unknown }).id ?? '');
    if (!id) return [];
    const timestamp = num(vehicle?.timestamp as Long);
    return [{
      id: `metra-${id}`,
      feed: 'metra',
      agency: 'Metra',
      lng,
      lat,
      route: String(pick(trip, 'route_id', 'routeId') ?? ''),
      trip: String(pick(trip, 'trip_id', 'tripId') ?? ''),
      label: String(descriptor?.label ?? id),
      bearing: num(position?.bearing),
      speedMps: num(position?.speed),
      updatedAt: timestamp ? new Date(timestamp * 1000).toISOString() : now.toISOString(),
      positionSource: 'Metra GTFS API',
    }];
  });
}

export function metraAuthorization(accessKey: string, secretKey: string): string {
  return `Basic ${btoa(`${accessKey}:${secretKey}`)}`;
}
