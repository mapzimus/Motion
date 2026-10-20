// New York City Subway and Staten Island Railway trains from the MTA
// GTFS-realtime feeds.
//
// The subway feeds carry no GPS. Each running train is a vehicle entity that
// names the station it is stopped at or heading to (`stopId`, with an N/S
// direction suffix) and a trip update, sharing the trip id, that lists the
// remaining stops with arrival times. The gateway joins the two and returns
// one compact record per train; the frontend places it on the line using the
// static station list and typical segment times, labelled as an estimate.

export type SubwayRoute = { name: string; color: string };

// Official trunk colors from the MTA subway GTFS routes.txt.
export const SUBWAY_ROUTES: Record<string, SubwayRoute> = {
  '1': { name: 'Broadway - 7 Avenue Local', color: '#ee352e' },
  '2': { name: '7 Avenue Express', color: '#ee352e' },
  '3': { name: '7 Avenue Express', color: '#ee352e' },
  '4': { name: 'Lexington Avenue Express', color: '#00933c' },
  '5': { name: 'Lexington Avenue Express', color: '#00933c' },
  '6': { name: 'Lexington Avenue Local', color: '#00933c' },
  '6X': { name: 'Pelham Bay Park Express', color: '#00933c' },
  '7': { name: 'Flushing Local', color: '#b933ad' },
  '7X': { name: 'Flushing Express', color: '#b933ad' },
  A: { name: '8 Avenue Express', color: '#0039a6' },
  C: { name: '8 Avenue Local', color: '#0039a6' },
  E: { name: '8 Avenue Local', color: '#0039a6' },
  B: { name: '6 Avenue Express', color: '#ff6319' },
  D: { name: '6 Avenue Express', color: '#ff6319' },
  F: { name: 'Queens Blvd Express / 6 Av Local', color: '#ff6319' },
  FX: { name: 'Brooklyn F Express', color: '#ff6319' },
  M: { name: 'Queens Blvd Local / 6 Av Local', color: '#ff6319' },
  G: { name: 'Brooklyn-Queens Crosstown', color: '#6cbe45' },
  J: { name: 'Nassau St Local', color: '#996633' },
  Z: { name: 'Nassau St Express', color: '#996633' },
  L: { name: '14 St-Canarsie Local', color: '#a7a9ac' },
  N: { name: 'Broadway Local', color: '#fccc0a' },
  Q: { name: 'Broadway Express', color: '#fccc0a' },
  R: { name: 'Broadway Local', color: '#fccc0a' },
  W: { name: 'Broadway Local', color: '#fccc0a' },
  GS: { name: '42 St Shuttle', color: '#808183' },
  FS: { name: 'Franklin Avenue Shuttle', color: '#808183' },
  H: { name: 'Rockaway Park Shuttle', color: '#808183' },
  SI: { name: 'Staten Island Railway', color: '#0039a6' },
};

// Public line name (the bullet): the route id except for the three shuttles.
export function subwayLineLabel(routeId: string): string {
  if (routeId === 'GS' || routeId === 'FS' || routeId === 'H') return 'S';
  if (routeId === 'SI') return 'SIR';
  return routeId;
}

// A vehicle report older than this is treated as gone.
export const SUBWAY_MAX_AGE_SECONDS = 5 * 60;

export type SubwayStatus = 'STOPPED_AT' | 'IN_TRANSIT_TO' | 'INCOMING_AT';

type RealtimeEvent = { time?: unknown } | null | undefined;
type StopTimeUpdate = { stopId?: string | null; arrival?: RealtimeEvent; departure?: RealtimeEvent };
export type SubwayEntity = {
  id: string;
  tripUpdate?: {
    trip?: { routeId?: string | null; tripId?: string | null } | null;
    stopTimeUpdate?: StopTimeUpdate[] | null;
  } | null;
  vehicle?: {
    trip?: { routeId?: string | null; tripId?: string | null } | null;
    currentStopSequence?: unknown;
    currentStatus?: unknown;
    timestamp?: unknown;
    stopId?: string | null;
    vehicle?: { id?: string | null; label?: string | null } | null;
  } | null;
};

export type SubwayTrain = {
  id: string;
  tripId: string;
  routeId: string;
  line: string;
  routeName: string;
  color: string;
  // The station the train is at (STOPPED_AT) or heading to.
  stopId: string;
  status: SubwayStatus;
  direction: 'N' | 'S' | '';
  // Realtime arrival at `stopId` (unix seconds), when the trip update has one.
  nextTime: number | null;
  destinationStopId: string;
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
  return numberValue(update.arrival?.time) ?? numberValue(update.departure?.time);
}

function statusOf(value: unknown): SubwayStatus {
  if (value === 1 || value === 'STOPPED_AT') return 'STOPPED_AT';
  if (value === 0 || value === 'INCOMING_AT') return 'INCOMING_AT';
  return 'IN_TRANSIT_TO';
}

// Strips a subway stop id to its station ("101N" -> "101"); SIR ids are "S27N".
export function stationOf(stopId: string): string {
  return /[NS]$/.test(stopId) ? stopId.slice(0, -1) : stopId;
}

export function subwayTrains(entities: SubwayEntity[], feedTimestamp: number): SubwayTrain[] {
  const updatesByTrip = new Map<string, NonNullable<SubwayEntity['tripUpdate']>>();
  for (const entity of entities) {
    const tripId = entity.tripUpdate?.trip?.tripId;
    if (entity.tripUpdate && tripId) updatesByTrip.set(tripId, entity.tripUpdate);
  }

  const seen = new Set<string>();
  return entities.flatMap((entity) => {
    const vehicle = entity.vehicle;
    const stopId = vehicle?.stopId ?? '';
    const tripId = vehicle?.trip?.tripId ?? '';
    const routeId = vehicle?.trip?.routeId ?? updatesByTrip.get(tripId)?.trip?.routeId ?? '';
    const route = SUBWAY_ROUTES[routeId];
    if (!vehicle || !stopId || !route) return [];
    const reportedAt = numberValue(vehicle.timestamp) ?? feedTimestamp;
    if (feedTimestamp - reportedAt > SUBWAY_MAX_AGE_SECONDS) return [];
    const id = tripId || entity.id;
    if (seen.has(id)) return [];
    seen.add(id);

    const update = tripId ? updatesByTrip.get(tripId) : undefined;
    const stops = (update?.stopTimeUpdate ?? []).flatMap((stop) => {
      const time = eventTime(stop);
      return stop.stopId ? [{ stopId: stop.stopId, time }] : [];
    });
    const atStop = stops.find((stop) => stationOf(stop.stopId) === stationOf(stopId)) ?? stops[0];
    const suffix = stopId.slice(-1);
    return [{
      id,
      tripId,
      routeId,
      line: subwayLineLabel(routeId),
      routeName: route.name,
      color: route.color,
      stopId,
      status: statusOf(vehicle.currentStatus),
      direction: suffix === 'N' || suffix === 'S' ? suffix : '' as const,
      nextTime: atStop?.time ?? null,
      destinationStopId: stops.at(-1)?.stopId ?? '',
      updatedAt: new Date(reportedAt * 1000).toISOString(),
    }];
  });
}
