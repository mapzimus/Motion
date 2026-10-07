// Peter Pan coaches from the public tracker, normalized by the gateway.
// They share the bus layer with agency buses.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';
import { coachItem } from './coaches-normalize.js';
import { paintVehicle } from '../stores/legend.js';

const NORMALIZE_OPTS = {
  busColor: CONFIG.BUS_COLOR,
  staleAfterMs: CONFIG.COACH_STALE_AFTER_MS,
};

export function startCoaches(onCounts, enabled = true) {
  if (!CONFIG.GATEWAY_BASE || !enabled) {
    onCounts({ bus: 0 });
    return { setRegion() {} };
  }

  const fleet = createFleet('coaches');
  let timer = null;
  let requestGeneration = 0;

  async function poll() {
    clearTimeout(timer);
    const thisGeneration = ++requestGeneration;
    if (document.hidden) {
      timer = setTimeout(poll, CONFIG.COACH_POLL_MS);
      return;
    }
    try {
      const response = await fetch(`${CONFIG.GATEWAY_BASE}/api/coaches`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Motion coach gateway ${response.status}`);
      const payload = await response.json();
      if (thisGeneration !== requestGeneration) return;
      const now = Date.now();
      const items = (payload.vehicles ?? []).map((vehicle) => paintVehicle(coachItem(vehicle, now, NORMALIZE_OPTS)));
      const visible = fleet.update(items);
      onCounts({ bus: visible.length });
    } catch (error) {
      console.warn('Peter Pan coaches unavailable:', error.message);
    }
    timer = setTimeout(poll, CONFIG.COACH_POLL_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });

  poll();
  return { setRegion() {} };
}
