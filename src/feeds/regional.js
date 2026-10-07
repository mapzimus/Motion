// Non-MBTA New England buses from agency GTFS-realtime vehicle feeds,
// normalized by the gateway into one small JSON payload.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';
import { gatewayRegion } from './regions.js';
import { regionalVehicleItem } from './regional-normalize.js';
import { paintVehicle } from '../stores/legend.js';

const POLL_MS = 20_000;
const PETER_PAN_TRACKER = 'https://bustracker.peterpanbus.com/';

// Upper-case names of ferries currently reported by an operator feed, so the
// AIS layer can skip the same boat instead of drawing it twice.
export const operatorFerryNames = new Set();
const NORMALIZE_OPTS = {
  ferryFeeds: CONFIG.FERRY_FEEDS,
  busColor: CONFIG.BUS_COLOR,
  ferryColor: CONFIG.FERRY_COLOR,
  staleAfterMs: CONFIG.STALE_AFTER_MS,
};

function peterPanItem(vehicle, now) {
  const item = paintVehicle(regionalVehicleItem(vehicle, now, NORMALIZE_OPTS));
  if (vehicle.from && vehicle.to) item.props.dest = `${vehicle.from} → ${vehicle.to}`;
  item.props.provider = 'Peter Pan public tracker';
  item.props.sourceUrl = PETER_PAN_TRACKER;
  item.props.meta = 'Peter Pan tracker';
  return item;
}

async function loadPeterPan() {
  try {
    const response = await fetch(`${CONFIG.GATEWAY_BASE}/api/peter-pan`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Peter Pan tracker ${response.status}`);
    const payload = await response.json();
    return payload.vehicles ?? [];
  } catch (error) {
    console.warn('Peter Pan coaches unavailable:', error.message);
    return null;
  }
}

export function startRegional(onCounts, initialRegion, enabled = true) {
  if (!CONFIG.GATEWAY_BASE) {
    onCounts({ bus: 0 });
    return { setRegion() {} };
  }

  const fleet = createFleet('regional');
  let region = initialRegion;
  let timer = null;
  let requestGeneration = 0;
  let transitVehicles = [];
  let coachVehicles = [];

  async function poll() {
    clearTimeout(timer);
    const thisGeneration = ++requestGeneration;
    if (document.hidden) {
      timer = setTimeout(poll, POLL_MS);
      return;
    }
    let changed = false;
    const coachesPromise = loadPeterPan();
    if (enabled) {
      try {
        const response = await fetch(
          `${CONFIG.GATEWAY_BASE}/api/transit?region=${encodeURIComponent(gatewayRegion(region))}`,
        );
        if (!response.ok) throw new Error(`Motion transit gateway ${response.status}`);
        const payload = await response.json();
        if (thisGeneration !== requestGeneration) return;
        transitVehicles = payload.vehicles ?? [];
        changed = true;
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
    }
    const coaches = await coachesPromise;
    if (thisGeneration !== requestGeneration) return;
    if (coaches) {
      coachVehicles = coaches;
      changed = true;
    }
    if (changed) {
      operatorFerryNames.clear();
      const now = Date.now();
      const items = [
        ...transitVehicles.map((vehicle) => {
          const item = paintVehicle(regionalVehicleItem(vehicle, now, NORMALIZE_OPTS));
          if (item.props.group === 'ferry' && vehicle.label) {
            operatorFerryNames.add(String(vehicle.label).trim().toUpperCase());
          }
          return item;
        }),
        ...coachVehicles.map((vehicle) => peterPanItem(vehicle, now)),
      ];
      const visible = fleet.update(items);
      const ferries = visible.filter((item) => item.props.group === 'ferry').length;
      onCounts({ bus: visible.length - ferries, ferry: ferries });
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
