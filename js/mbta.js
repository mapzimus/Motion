// MBTA fleet poller: one request covers subway, Silver Line, commuter rail,
// buses, and ferries. Vehicles are classified into layer groups client-side.
// This is also the app's primary heartbeat — it drives the status line.

import { CONFIG } from './config.js';
import { fetchVehicles } from './api.js';
import { createFleet } from './fleet.js';

// Groups this poller can produce (used to zero counts each cycle).
export const MBTA_GROUPS = [
  'red', 'orange', 'green', 'blue', 'silver', 'mattapan',
  'commuter', 'bus', 'ferry',
];

export function groupFor(routeId, info) {
  if (CONFIG.SILVER_ROUTES.includes(routeId)) return 'silver';
  switch (info?.type) {
    case 2: return 'commuter';
    case 3: return 'bus';
    case 4: return 'ferry';
  }
  if (routeId === 'Mattapan') return 'mattapan';
  if (routeId.startsWith('Green')) return 'green';
  return routeId.toLowerCase(); // Red / Orange / Blue
}

function titleFor(group, routeId, info) {
  switch (group) {
    case 'silver': return `Silver Line ${info?.shortName ?? ''}`.trim();
    case 'bus': return `Bus ${info?.shortName || routeId}`;
    default: return info?.longName ?? routeId;
  }
}

let routeInfo = new Map();
let formatStatus = () => '';
let fleet = null;
let pollTimer = null;
let backoffMs = 0;

const statsListeners = [];
const statusListeners = [];
export const onStats = (fn) => statsListeners.push(fn);
export const onStatus = (fn) => statusListeners.push(fn);
const emitStatus = (state, detail = {}) =>
  statusListeners.forEach((fn) => fn(state, detail));

export function startMbta(routes, statusFormatter) {
  routeInfo = routes;
  formatStatus = statusFormatter;
  fleet = createFleet('mbta');

  // When the tab is hidden we stop hitting the API; on return, refresh at once.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      clearTimeout(pollTimer);
      poll();
    }
  });
  poll();
}

async function poll() {
  if (document.hidden) {
    emitStatus('paused');
    pollTimer = setTimeout(poll, CONFIG.VEHICLE_POLL_MS);
    return;
  }
  try {
    const vehicles = await fetchVehicles();
    backoffMs = 0;
    apply(vehicles);
    emitStatus('live');
    pollTimer = setTimeout(poll, CONFIG.VEHICLE_POLL_MS);
  } catch (err) {
    // Exponential backoff keeps us polite toward the API when it's unhappy.
    backoffMs = Math.min(backoffMs ? backoffMs * 2 : CONFIG.VEHICLE_POLL_MS, 60_000);
    emitStatus('error', { retryInMs: backoffMs, message: err.message });
    pollTimer = setTimeout(poll, backoffMs);
  }
}

function apply(vehicles) {
  const now = Date.now();
  const byGroup = Object.fromEntries(MBTA_GROUPS.map((g) => [g, 0]));

  const items = vehicles.map((v) => {
    const info = routeInfo.get(v.route);
    const group = groupFor(v.route, info);
    return {
      id: v.id,
      lng: v.lng,
      lat: v.lat,
      props: {
        group,
        dataStatus: 'live',
        color: info?.color ?? '#8a939c',
        bearing: v.bearing ?? 0,
        hasBearing: typeof v.bearing === 'number',
        stale: now - Date.parse(v.updatedAt) > CONFIG.STALE_AFTER_MS,
        title: titleFor(group, v.route, info),
        dest: info?.destinations?.[v.directionId]
          ? `to ${info.destinations[v.directionId]}`
          : '',
        status: formatStatus(v),
        meta: [v.label ? `car ${v.label}` : '', v.occupancy.toLowerCase()]
          .filter(Boolean)
          .join(' · '),
        provider: 'MBTA V3 vehicle feed',
        sourceUrl: 'https://www.mbta.com/developers/v3-api',
        updatedAt: v.updatedAt,
      },
    };
  });

  const visible = fleet.update(items);
  for (const item of visible) {
    const group = item.props.group;
    byGroup[group] = (byGroup[group] ?? 0) + 1;
  }
  statsListeners.forEach((fn) => fn({ byGroup, lastUpdate: now }));
}
