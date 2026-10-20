// Pure New York City Subway train -> map item conversion, free of browser
// globals so the gateway test pool can exercise it.
//
// The MTA subway feeds carry no GPS. Each train names the station it is at
// (STOPPED_AT) or heading to, and its trip update gives the arrival time
// there. The station list and the typical scheduled time between consecutive
// stations (built from the static GTFS into nyc-subway-stops.json) place the
// train between the previous station on its line and the one it is heading
// to. Every subway position is an estimate and is labelled so.

import { bearingBetween } from './metro-north-normalize.js';

// Where a train is drawn along the segment when no arrival time is known.
const PROGRESS_WITHOUT_ETA = { IN_TRANSIT_TO: 0.5, INCOMING_AT: 0.85 };

function stationOf(stopId) {
  return /[NS]$/.test(stopId) ? stopId.slice(0, -1) : stopId;
}

function stopFor(stops, stopId) {
  return stops[stopId] ?? stops[stationOf(stopId)] ?? null;
}

// The single previous station on this route for a train heading to `stopId`,
// or null when the line branches there (then the train sits at the station).
function previousStation(segments, routeId, stopId) {
  const candidates = segments?.[routeId]?.[stopId];
  if (!candidates) return null;
  const entries = Object.entries(candidates);
  if (entries.length !== 1) return null;
  const [previousStopId, seconds] = entries[0];
  return { previousStopId, seconds: Number(seconds) || 0 };
}

export function subwayTrainItem(train, { stops = {}, segments = {} }, { staleAfterMs = 120_000, now = Date.now() } = {}) {
  const next = stopFor(stops, train.stopId);
  if (!next) return null;
  const destination = train.destinationStopId ? stopFor(stops, train.destinationStopId) : null;
  const remainingSeconds = Number.isFinite(train.nextTime) ? (train.nextTime * 1000 - now) / 1000 : null;
  const minutes = remainingSeconds === null ? null : Math.max(0, Math.round(remainingSeconds / 60));

  let lng = next.lng;
  let lat = next.lat;
  let bearing = 0;
  let hasBearing = false;
  let status = `At ${next.name}`;
  if (train.status !== 'STOPPED_AT') {
    const eta = minutes === null ? '' : ` · ${minutes ? `${minutes} min` : 'due'}`;
    status = `Next stop ${next.name}${eta}`;
    const link = previousStation(segments, train.routeId, train.stopId);
    const previous = link ? stopFor(stops, link.previousStopId) : null;
    if (previous && previous !== next) {
      let progress = PROGRESS_WITHOUT_ETA[train.status] ?? 0.5;
      if (remainingSeconds !== null && link.seconds > 0) {
        progress = 1 - remainingSeconds / link.seconds;
      }
      progress = Math.max(0.05, Math.min(0.97, progress));
      lng = previous.lng + (next.lng - previous.lng) * progress;
      lat = previous.lat + (next.lat - previous.lat) * progress;
      bearing = bearingBetween(previous, next);
      hasBearing = true;
      status = `${previous.name} → ${next.name}${eta}`;
    }
  }

  const label = train.line || train.routeId;
  return {
    id: `nyc-subway-${train.id}`,
    detail: {
      trainNumber: '',
      routeName: `${label} · ${train.routeName}`,
      headsign: destination?.name ?? '',
      nextStop: next.name,
      nextMinutes: minutes,
    },
    lng,
    lat,
    props: {
      group: 'nyc-subway',
      route: label,
      dataStatus: 'estimated',
      legendKey: 'nyc-subway',
      legendLabel: 'New York City Subway',
      modeColor: train.color,
      color: train.color,
      shadeKey: train.routeId ? `nyc-subway:${train.routeId}` : '',
      bearing,
      hasBearing,
      stale: now - Date.parse(train.updatedAt) > staleAfterMs,
      title: `Subway · ${label} train`,
      dest: destination ? `${label} to ${destination.name}` : `${label} train`,
      status,
      meta: 'Estimated from MTA trip updates · the subway feeds carry no GPS',
      provider: 'MTA New York City Transit GTFS-Realtime',
      sourceUrl: 'https://www.mta.info/developers',
      updatedAt: train.updatedAt,
    },
  };
}
