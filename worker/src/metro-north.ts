// Metro-North trains on the Connecticut lines, from the MTA GTFS-realtime feed.
//
// The feed carries a trip update for every train of the day and, for trains
// that are actually running, a vehicle entity with a GPS position. A train with
// a fresh GPS fix is reported at that fix. A train without one is still placed
// between the two stations its realtime stop times straddle, and is labelled
// as an estimate by the frontend.

export const MNR_ROUTES: Record<string, { name: string; color: string }> = {
  '3': { name: 'New Haven', color: '#ee0034' },
  '4': { name: 'New Canaan', color: '#ee0034' },
  '5': { name: 'Danbury', color: '#ee0034' },
  '6': { name: 'Waterbury', color: '#ee0034' },
};

// A GPS fix older than this is treated as missing.
export const MNR_GPS_MAX_AGE_SECONDS = 5 * 60;
// Generous box around the whole Metro-North network (Grand Central to New
// Haven, Wassaic and Waterbury); rejects zeroed or garbage coordinates.
const MNR_BOX = { west: -74.3, south: 40.6, east: -72.7, north: 41.95 };

type RealtimeEvent = { time?: unknown } | null | undefined;
type StopTimeUpdate = { stopId?: string | null; arrival?: RealtimeEvent; departure?: RealtimeEvent };
type MnrEntity = {
  id: string;
  tripUpdate?: {
    trip?: { routeId?: string | null; tripId?: string | null } | null;
    stopTimeUpdate?: StopTimeUpdate[] | null;
  } | null;
  vehicle?: {
    position?: { latitude?: unknown; longitude?: unknown } | null;
    timestamp?: unknown;
    vehicle?: { id?: string | null; label?: string | null } | null;
  } | null;
};

export type MnrTrip = {
  id: string;
  tripId: string;
  label: string;
  routeId: string;
  routeName: string;
  color: string;
  positioning: 'gps' | 'estimated';
  position: { lat: number; lng: number; at: string } | null;
  previousStopId: string;
  previousTime: number | null;
  nextStopId: string;
  nextTime: number | null;
  destinationStopId: string;
  progress: number;
  updatedAt: string;
};

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' && 'toNumber' in (value as object)) {
    const converted = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(converted) ? converted : null;
  }
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function eventTime(update: StopTimeUpdate): number | null {
  return numberValue(update.departure?.time) ?? numberValue(update.arrival?.time);
}

function gpsFix(entity: MnrEntity, feedTimestamp: number): MnrTrip['position'] {
  const lat = numberValue(entity.vehicle?.position?.latitude);
  const lng = numberValue(entity.vehicle?.position?.longitude);
  if (lat === null || lng === null) return null;
  if (lng < MNR_BOX.west || lng > MNR_BOX.east || lat < MNR_BOX.south || lat > MNR_BOX.north) return null;
  const at = numberValue(entity.vehicle?.timestamp) ?? feedTimestamp;
  if (feedTimestamp - at > MNR_GPS_MAX_AGE_SECONDS) return null;
  return { lat, lng, at: new Date(at * 1000).toISOString() };
}

export function metroNorthTrips(entities: MnrEntity[], feedTimestamp: number): MnrTrip[] {
  return entities.flatMap((entity) => {
    const update = entity.tripUpdate;
    const routeId = update?.trip?.routeId ?? '';
    const route = MNR_ROUTES[routeId];
    if (!update || !route) return [];

    const timedStops = (update.stopTimeUpdate ?? []).flatMap((stop) => {
      const time = eventTime(stop);
      return time === null || !stop.stopId ? [] : [{ stopId: stop.stopId, time }];
    });
    if (!timedStops.length) return [];

    let previousIndex = -1;
    for (let index = 0; index < timedStops.length; index += 1) {
      if (timedStops[index].time <= feedTimestamp) previousIndex = index;
      else break;
    }
    // Every realtime stop time has passed: the train has finished its trip.
    if (previousIndex >= timedStops.length - 1) return [];

    const position = gpsFix(entity, feedTimestamp);
    // Without GPS a train can only be placed between two timed stations.
    if (!position && previousIndex < 0) return [];

    const previous = previousIndex >= 0 ? timedStops[previousIndex] : null;
    const next = timedStops[previousIndex + 1];
    const progress = previous
      ? Math.max(0, Math.min(1, (feedTimestamp - previous.time) / Math.max(1, next.time - previous.time)))
      : 0;
    return [{
      id: entity.id,
      tripId: update.trip?.tripId ?? '',
      label: entity.vehicle?.vehicle?.label || entity.vehicle?.vehicle?.id || entity.id,
      routeId,
      routeName: route.name,
      color: route.color,
      positioning: position ? 'gps' as const : 'estimated' as const,
      position,
      previousStopId: previous?.stopId ?? '',
      previousTime: previous?.time ?? null,
      nextStopId: next.stopId,
      nextTime: next.time,
      destinationStopId: timedStops.at(-1)?.stopId ?? next.stopId,
      progress,
      updatedAt: new Date(feedTimestamp * 1000).toISOString(),
    }];
  });
}
