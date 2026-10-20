// MTA commuter trains (Metro-North and the Long Island Rail Road) from the
// MTA GTFS-realtime feeds.
//
// Each feed carries a trip update for every train of the day and, for trains
// that are actually running, a vehicle entity with a GPS position. Metro-North
// puts both in one entity; the LIRR publishes them as separate entities that
// share a trip id, so vehicles are joined to trips by trip id first and by
// entity second. A train with a fresh GPS fix is reported at that fix. A train
// without one is still placed between the two stations its realtime stop
// times straddle, and is labelled as an estimate by the frontend.

export type RailRoute = { name: string; color: string };

// Metro-North route ids and official line colors. The New Haven Line branches
// carry Connecticut; Hudson and Harlem are New York only.
export const MNR_ROUTES: Record<string, RailRoute> = {
  '1': { name: 'Hudson', color: '#009b3a' },
  '2': { name: 'Harlem', color: '#0039a6' },
  '3': { name: 'New Haven', color: '#ee0034' },
  '4': { name: 'New Canaan', color: '#ee0034' },
  '5': { name: 'Danbury', color: '#ee0034' },
  '6': { name: 'Waterbury', color: '#ee0034' },
};

// Long Island Rail Road branches and the colors from its static GTFS routes.txt.
export const LIRR_ROUTES: Record<string, RailRoute> = {
  '1': { name: 'Babylon', color: '#00985f' },
  '2': { name: 'Hempstead', color: '#ce8e00' },
  '3': { name: 'Oyster Bay', color: '#00af3f' },
  '4': { name: 'Ronkonkoma', color: '#a626aa' },
  '5': { name: 'Montauk', color: '#00b2a9' },
  '6': { name: 'Long Beach', color: '#ff6319' },
  '7': { name: 'Far Rockaway', color: '#6e3219' },
  '8': { name: 'West Hempstead', color: '#00a1de' },
  '9': { name: 'Port Washington', color: '#c60c30' },
  '10': { name: 'Port Jefferson', color: '#006ec7' },
  '11': { name: 'Belmont Park', color: '#60269e' },
  '12': { name: 'City Terminal Zone', color: '#4d5357' },
  '13': { name: 'Greenport', color: '#a626aa' },
};

// A GPS fix older than this is treated as missing.
export const MNR_GPS_MAX_AGE_SECONDS = 5 * 60;
// Generous box around both networks (Grand Central and Penn Station to New
// Haven, Wassaic, Poughkeepsie, Port Jervis, Greenport and Montauk); rejects
// zeroed or garbage coordinates.
const RAIL_BOX = { west: -74.8, south: 40.5, east: -71.8, north: 42.0 };

type RealtimeEvent = { time?: unknown } | null | undefined;
type StopTimeUpdate = { stopId?: string | null; arrival?: RealtimeEvent; departure?: RealtimeEvent };
export type RailVehicle = {
  position?: { latitude?: unknown; longitude?: unknown } | null;
  timestamp?: unknown;
  trip?: { tripId?: string | null } | null;
  vehicle?: { id?: string | null; label?: string | null } | null;
};
export type MnrEntity = {
  id: string;
  tripUpdate?: {
    trip?: { routeId?: string | null; tripId?: string | null } | null;
    stopTimeUpdate?: StopTimeUpdate[] | null;
  } | null;
  vehicle?: RailVehicle | null;
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

function gpsFix(vehicle: RailVehicle | null | undefined, feedTimestamp: number): MnrTrip['position'] {
  const lat = numberValue(vehicle?.position?.latitude);
  const lng = numberValue(vehicle?.position?.longitude);
  if (lat === null || lng === null) return null;
  if (lng < RAIL_BOX.west || lng > RAIL_BOX.east || lat < RAIL_BOX.south || lat > RAIL_BOX.north) return null;
  const at = numberValue(vehicle?.timestamp) ?? feedTimestamp;
  if (feedTimestamp - at > MNR_GPS_MAX_AGE_SECONDS) return null;
  return { lat, lng, at: new Date(at * 1000).toISOString() };
}

// Trains on `routes`, one per trip update, with the GPS vehicle (same entity
// or a separate entity sharing the trip id) attached when there is one.
export function railTrips(
  entities: MnrEntity[],
  feedTimestamp: number,
  routes: Record<string, RailRoute>,
): MnrTrip[] {
  const vehiclesByTrip = new Map<string, RailVehicle>();
  for (const entity of entities) {
    const tripId = entity.vehicle?.trip?.tripId;
    if (entity.vehicle && tripId) vehiclesByTrip.set(tripId, entity.vehicle);
  }

  return entities.flatMap((entity) => {
    const update = entity.tripUpdate;
    const routeId = update?.trip?.routeId ?? '';
    const route = routes[routeId];
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

    const tripId = update.trip?.tripId ?? '';
    const vehicle = entity.vehicle ?? (tripId ? vehiclesByTrip.get(tripId) : undefined) ?? null;
    const position = gpsFix(vehicle, feedTimestamp);
    // Without GPS a train can only be placed between two timed stations.
    if (!position && previousIndex < 0) return [];

    const previous = previousIndex >= 0 ? timedStops[previousIndex] : null;
    const next = timedStops[previousIndex + 1];
    const progress = previous
      ? Math.max(0, Math.min(1, (feedTimestamp - previous.time) / Math.max(1, next.time - previous.time)))
      : 0;
    return [{
      id: entity.id,
      tripId,
      label: vehicle?.vehicle?.label || vehicle?.vehicle?.id || entity.id,
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

export function metroNorthTrips(entities: MnrEntity[], feedTimestamp: number): MnrTrip[] {
  return railTrips(entities, feedTimestamp, MNR_ROUTES);
}

export function lirrTrips(entities: MnrEntity[], feedTimestamp: number): MnrTrip[] {
  return railTrips(entities, feedTimestamp, LIRR_ROUTES);
}
