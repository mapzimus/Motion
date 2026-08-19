// Non-MBTA New England buses from agency GTFS-realtime vehicle feeds,
// normalized by the gateway into one small JSON payload.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';

const POLL_MS = 20_000;
const MPS_TO_MPH = 2.23694;

export function startRegional(onCounts, initialRegion, enabled = true) {
  if (!CONFIG.GATEWAY_BASE || !enabled) {
    onCounts({ bus: 0 });
    return { setRegion() {} };
  }

  const fleet = createFleet('regional');
  let region = initialRegion;
  let timer = null;
  let requestGeneration = 0;

  async function poll() {
    clearTimeout(timer);
    const thisGeneration = ++requestGeneration;
    if (document.hidden) {
      timer = setTimeout(poll, POLL_MS);
      return;
    }
    try {
      const response = await fetch(
        `${CONFIG.GATEWAY_BASE}/api/transit?region=${encodeURIComponent(region)}`,
      );
      if (!response.ok) throw new Error(`Motion transit gateway ${response.status}`);
      const payload = await response.json();
      if (thisGeneration !== requestGeneration) return;

      const items = (payload.vehicles ?? []).map((vehicle) => ({
        id: `regional-${vehicle.id}`,
        lng: vehicle.lng,
        lat: vehicle.lat,
        props: {
          group: 'bus',
          color: CONFIG.BUS_COLOR,
          bearing: vehicle.bearing ?? 0,
          hasBearing: Number.isFinite(vehicle.bearing),
          stale: Date.now() - Date.parse(vehicle.updatedAt) > CONFIG.STALE_AFTER_MS,
          title: vehicle.route ? `${vehicle.agency} · ${vehicle.route}` : vehicle.agency,
          dest: vehicle.label ? `Vehicle ${vehicle.label}` : '',
          status: Number.isFinite(vehicle.speedMps)
            ? `${Math.round(vehicle.speedMps * MPS_TO_MPH)} mph`
            : 'In service',
          meta: `GTFS-RT · ${vehicle.feed}`,
          updatedAt: vehicle.updatedAt,
        },
      }));
      const visible = fleet.update(items);
      onCounts({ bus: visible.length });

      const unavailable = (payload.feeds ?? []).filter((feed) => feed.state !== 'live');
      if (unavailable.length) {
        console.info(
          'Regional feeds not active:',
          unavailable.map((feed) => `${feed.agency} (${feed.state})`).join(', '),
        );
      }
    } catch (error) {
      console.warn('Regional transit unavailable:', error.message);
    }
    timer = setTimeout(poll, POLL_MS);
  }

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
