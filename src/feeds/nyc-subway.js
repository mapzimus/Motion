// New York City Subway and Staten Island Railway trains from the official MTA
// GTFS-Realtime feeds through the gateway. The feeds carry no GPS, so every
// train is placed from the station it reports and labelled estimated.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';
import { gatewayRegion } from './regions.js';
import { normalizeAlerts } from './metro-north.js';
import { subwayTrainItem } from './nyc-subway-normalize.js';
import { paintVehicle } from '../stores/legend.js';

const REGIONS = ['ny', 'northeast'];
let networkPromise = null;

function loadNetwork() {
  if (!networkPromise) {
    networkPromise = fetch(CONFIG.NYC_SUBWAY_STOPS_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Subway stops ${response.status}`);
        return response.json();
      })
      .then((payload) => ({ stops: payload.stops ?? {}, segments: payload.segments ?? {} }));
  }
  return networkPromise;
}

export function startNycSubway(onCounts, onAlerts, initialRegion, enabled = true) {
  const fleet = createFleet('nyc-subway');
  let region = initialRegion;
  let timer = null;
  let requestGeneration = 0;

  const clear = () => {
    fleet.update([]);
    onCounts({ 'nyc-subway': 0 });
    onAlerts([]);
  };

  const poll = async () => {
    clearTimeout(timer);
    const generation = ++requestGeneration;
    if (!enabled || !CONFIG.GATEWAY_BASE || !REGIONS.includes(gatewayRegion(region))) {
      clear();
      return;
    }
    if (document.hidden) {
      timer = setTimeout(poll, CONFIG.NYC_SUBWAY_POLL_MS);
      return;
    }
    try {
      const [network, response] = await Promise.all([
        loadNetwork(),
        fetch(`${CONFIG.GATEWAY_BASE}/api/nyc-subway`, { signal: AbortSignal.timeout(15_000) }),
      ]);
      if (!response.ok) throw new Error(`Motion subway gateway ${response.status}`);
      const payload = await response.json();
      if (generation !== requestGeneration) return;
      const items = (payload.trains ?? [])
        .map((train) => subwayTrainItem(train, network, { staleAfterMs: CONFIG.MNR_STALE_MS }))
        .filter(Boolean)
        .map(paintVehicle);
      const visible = fleet.update(items);
      onCounts({ 'nyc-subway': visible.length });
      onAlerts(normalizeAlerts(payload.alerts ?? [], network.stops));
    } catch (error) {
      console.warn('Subway realtime unavailable:', error.message);
    }
    timer = setTimeout(poll, CONFIG.NYC_SUBWAY_POLL_MS);
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
