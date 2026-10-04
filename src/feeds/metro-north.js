// Metro-North trains from the official MTA GTFS-Realtime feed. A train that is
// running reports a GPS position, shown as live. A train with no fresh fix is
// placed between the two stations its realtime stop times straddle and is
// labelled estimated.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';
import { gatewayRegion } from './regions.js';
import { trainItem } from './metro-north-normalize.js';

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
    if (!enabled || !CONFIG.GATEWAY_BASE || !['ct', 'new-england'].includes(gatewayRegion(region))) {
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
        .map((trip) => trainItem(trip, stops, { color: CONFIG.MNR_COLOR, staleAfterMs: CONFIG.MNR_STALE_MS }))
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
