// Service alert poller. Beyond fetching, this module:
//  1. filters noise — ordinary single-bus-route alerts are legion, so bus-only
//     alerts must be severe to make the panel (Silver Line always qualifies),
//  2. resolves the stops each alert names into coordinates, so clicking an
//     alert can fly the map to the affected place.

import { CONFIG } from './config.js';
import { fetchAlerts, fetchStopCoords } from './api.js';

const stopCoordCache = new Map(); // stop id -> [lng, lat], stable across polls

function isRelevant(alert, routeInfo) {
  const nonBus = alert.routes.some(
    (r) => CONFIG.SILVER_ROUTES.includes(r) || routeInfo.get(r)?.type !== 3,
  );
  return nonBus || alert.severity >= CONFIG.ALERT_LEVELS.major;
}

async function attachFocus(alerts) {
  const unresolved = [
    ...new Set(alerts.flatMap((a) => a.stops).filter((id) => !stopCoordCache.has(id))),
  ].slice(0, 250);
  if (unresolved.length) {
    try {
      const coords = await fetchStopCoords(unresolved);
      for (const [id, lngLat] of coords) stopCoordCache.set(id, lngLat);
    } catch (err) {
      // Alerts still render, just fall back to route-extent focus.
      console.warn('Alert stop lookup failed:', err.message);
    }
  }
  for (const alert of alerts) {
    const points = alert.stops
      .map((id) => stopCoordCache.get(id))
      .filter(Boolean);
    alert.focus = { points };
  }
}

export function startAlertPolling(routeInfo, onAlerts) {
  const poll = async () => {
    if (document.hidden) return;
    try {
      const all = await fetchAlerts();
      const alerts = all.filter((a) => isRelevant(a, routeInfo));
      alerts.sort((a, b) => b.severity - a.severity);
      await attachFocus(alerts);
      onAlerts(alerts);
    } catch (err) {
      // Non-fatal: keep showing the last known alerts; the MBTA poller owns
      // the visible connection-status reporting.
      console.warn('Alerts unavailable:', err.message);
    }
  };
  poll();
  setInterval(poll, CONFIG.ALERT_POLL_MS);
}
