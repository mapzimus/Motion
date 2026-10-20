// MTA commuter trains (Metro-North, Long Island Rail Road) from the official
// MTA GTFS-Realtime feeds through the gateway. A train that is running reports
// a GPS position, shown as live. A train with no fresh fix is placed between
// the two stations its realtime stop times straddle and is labelled estimated.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';
import { gatewayRegion } from './regions.js';
import { LIRR, METRO_NORTH, trainItem } from './metro-north-normalize.js';
import { paintVehicle } from '../stores/legend.js';

const stopsPromises = new Map();

function loadStops(url) {
  if (!stopsPromises.has(url)) {
    stopsPromises.set(url, fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Rail stops ${response.status}`);
        return response.json();
      })
      .then((payload) => payload.stops ?? {}));
  }
  return stopsPromises.get(url);
}

export function normalizeAlerts(alerts, stops) {
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

// One poller per MTA rail feed. `regions` lists the gateway regions whose view
// includes the railroad; elsewhere the fleet is cleared and nothing is fetched.
function startMtaRail({ fleetId, endpoint, stopsUrl, color, service, regions, label }, onCounts, onAlerts, initialRegion, enabled = true) {
  const fleet = createFleet(fleetId);
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
    if (!enabled || !CONFIG.GATEWAY_BASE || !regions.includes(gatewayRegion(region))) {
      clear();
      return;
    }
    if (document.hidden) {
      timer = setTimeout(poll, CONFIG.MNR_POLL_MS);
      return;
    }
    try {
      const [stops, response] = await Promise.all([
        loadStops(stopsUrl),
        fetch(`${CONFIG.GATEWAY_BASE}${endpoint}`, { signal: AbortSignal.timeout(12_000) }),
      ]);
      if (!response.ok) throw new Error(`Motion ${label} gateway ${response.status}`);
      const payload = await response.json();
      if (generation !== requestGeneration) return;
      const items = (payload.trips ?? [])
        .map((trip) => trainItem(trip, stops, { color, staleAfterMs: CONFIG.MNR_STALE_MS, service }))
        .filter(Boolean)
        .map(paintVehicle);
      const visible = fleet.update(items);
      onCounts({ commuter: visible.length });
      onAlerts(normalizeAlerts(payload.alerts ?? [], stops));
    } catch (error) {
      console.warn(`${label} realtime unavailable:`, error.message);
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

export function startMetroNorth(onCounts, onAlerts, initialRegion, enabled = true) {
  return startMtaRail({
    fleetId: 'mnr',
    endpoint: '/api/mnr',
    stopsUrl: CONFIG.MNR_STOPS_URL,
    color: CONFIG.MNR_COLOR,
    service: METRO_NORTH,
    regions: ['ct', 'ny', 'new-england', 'northeast'],
    label: 'Metro-North',
  }, onCounts, onAlerts, initialRegion, enabled);
}

export function startLirr(onCounts, onAlerts, initialRegion, enabled = true) {
  return startMtaRail({
    fleetId: 'lirr',
    endpoint: '/api/lirr',
    stopsUrl: CONFIG.LIRR_STOPS_URL,
    color: CONFIG.LIRR_COLOR,
    service: LIRR,
    regions: ['ny', 'northeast'],
    label: 'LIRR',
  }, onCounts, onAlerts, initialRegion, enabled);
}
