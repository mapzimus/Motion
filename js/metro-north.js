// Metro-North does not publish GPS vehicle positions. These dots interpolate
// between stations using the official MTA GTFS-Realtime trip-update feed.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';

let stopsPromise = null;

function loadStops() {
  if (!stopsPromise) {
    stopsPromise = fetch(CONFIG.MNR_STOPS_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Metro-North stops ${response.status}`);
        return response.json();
      })
      .then((payload) => payload.stops ?? {});
  }
  return stopsPromise;
}

function bearingBetween(from, to) {
  const radians = Math.atan2(to.lng - from.lng, to.lat - from.lat);
  return (radians * 180 / Math.PI + 360) % 360;
}

function trainItem(trip, stops) {
  const previous = stops[trip.previousStopId];
  const next = stops[trip.nextStopId];
  const destination = stops[trip.destinationStopId];
  if (!previous || !next) return null;
  const progress = Math.max(0, Math.min(1, Number(trip.progress) || 0));
  const minutes = Math.max(0, Math.round((trip.nextTime * 1000 - Date.now()) / 60_000));
  return {
    id: `mnr-${trip.id}`,
    lng: previous.lng + (next.lng - previous.lng) * progress,
    lat: previous.lat + (next.lat - previous.lat) * progress,
    props: {
      group: 'commuter',
      dataStatus: 'estimated',
      color: trip.color ?? CONFIG.MNR_COLOR,
      bearing: bearingBetween(previous, next),
      hasBearing: true,
      stale: Date.now() - Date.parse(trip.updatedAt) > CONFIG.MNR_STALE_MS,
      title: `Metro-North · ${trip.routeName} Line`,
      dest: `${trip.label ? `Train ${trip.label}` : 'Train'}${destination ? ` to ${destination.name}` : ''}`,
      status: `${previous.name} → ${next.name} · ${minutes ? `${minutes} min` : 'due'}`,
      meta: 'Estimated position from MTA trip updates',
      provider: 'MTA Metro-North GTFS-Realtime',
      sourceUrl: 'https://www.mta.info/developers',
      updatedAt: trip.updatedAt,
    },
  };
}

function normalizeAlerts(alerts, stops) {
  return alerts.map((alert) => ({
    ...alert,
    stops: alert.stopIds ?? [],
    focus: {
      points: (alert.stopIds ?? [])
        .map((stopId) => stops[stopId])
        .filter(Boolean)
        .map((stop) => [stop.lng, stop.lat]),
    },
  }));
}

export function startMetroNorth(onCounts, onAlerts, initialRegion, enabled = true) {
  const fleet = createFleet('mnr');
  let region = initialRegion;
  let timer = null;
  let requestGeneration = 0;

  const clear = () => {
    fleet.update([]);
    onCounts({ commuter: 0 });
    onAlerts([]);
  };

  const poll = async () => {
    clearTimeout(timer);
    const generation = ++requestGeneration;
    if (!enabled || !CONFIG.GATEWAY_BASE || !['ct', 'new-england'].includes(region)) {
      clear();
      return;
    }
    if (document.hidden) {
      timer = setTimeout(poll, CONFIG.MNR_POLL_MS);
      return;
    }
    try {
      const [stops, response] = await Promise.all([
        loadStops(),
        fetch(`${CONFIG.GATEWAY_BASE}/api/mnr`, { signal: AbortSignal.timeout(12_000) }),
      ]);
      if (!response.ok) throw new Error(`Motion Metro-North gateway ${response.status}`);
      const payload = await response.json();
      if (generation !== requestGeneration) return;
      const items = (payload.trips ?? [])
        .map((trip) => trainItem(trip, stops))
        .filter(Boolean);
      const visible = fleet.update(items);
      onCounts({ commuter: visible.length });
      onAlerts(normalizeAlerts(payload.alerts ?? [], stops));
    } catch (error) {
      console.warn('Metro-North realtime unavailable:', error.message);
    }
    timer = setTimeout(poll, CONFIG.MNR_POLL_MS);
  };

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
  poll();
  return {
    setRegion(nextRegion) {
      region = nextRegion;
      clearTimeout(timer);
      poll();
    },
  };
}
