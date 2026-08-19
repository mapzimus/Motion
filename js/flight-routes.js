// Best-effort scheduled route enrichment, fetched only when a plane is clicked.

import { CONFIG } from './config.js';

const cache = new Map();

export function lookupFlightRoute(callsign) {
  const key = String(callsign ?? '').trim().toUpperCase();
  if (!key || !CONFIG.AIRCRAFT_GATEWAY_BASE) return Promise.resolve(null);
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const response = await fetch(
        `${CONFIG.AIRCRAFT_GATEWAY_BASE}/api/route?callsign=${encodeURIComponent(key)}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`route lookup ${response.status}`);
      return response.json();
    })().catch((error) => {
      cache.delete(key);
      throw error;
    }));
  }
  return cache.get(key);
}
