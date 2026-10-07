// MBTA fleet poller: one request covers subway, Silver Line, commuter rail,
// buses, and ferries. Vehicles are classified into layer groups client-side.
// This is also the app's primary heartbeat — it drives the status line.

import { CONFIG } from './config.js';
import { fetchVehicles } from './api.js';
import { createFleet } from './fleet.js';
import { paintVehicle } from '../stores/legend.js';

// Groups this poller can produce (used to zero counts each cycle).
export const MBTA_GROUPS = [
  'red', 'orange', 'green', 'blue', 'silver', 'mattapan',
  'commuter', 'bus', 'ferry',
];

// Rail-replacement buses stay in the vehicle poll with listed_route false, so
// they have no route record. Their ids still start with Shuttle-.
function isRailReplacementRoute(routeId) {
  return /^Shuttle-/i.test(routeId ?? '');
}

export function groupFor(routeId, info) {
  if (isRailReplacementRoute(routeId)) return 'bus';
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

// Commuter rail trip ids end in the public train number
// ("SouthBase-793096-5847" -> 5847); verified on every line 2026-09-27.
// Riders search by train number, not by the car label MBTA puts on vehicles.
export function trainNumberFor(routeId, tripId) {
  if (!routeId?.startsWith('CR-') || !tripId) return '';
  const suffix = String(tripId).split('-').at(-1);
  return /^\d{3,5}$/.test(suffix) ? suffix : '';
}

export function titleFor(group, routeId, info) {
  if (isRailReplacementRoute(routeId)) return 'Rail replacement bus';
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
    const trainNumber = trainNumberFor(v.route, v.tripId);
    const baseColor = info?.color ?? '#8a939c';
    // Bus, ferry and commuter rail take the operator palette (paintVehicle);
    // subway lines keep their route color.
    return paintVehicle({
      id: v.id,
      detail: {
        tripId: v.tripId,
        stopSequence: v.stopSequence,
        route: v.route,
        routeName: info?.longName || info?.shortName || v.route,
        routeShortName: info?.shortName || '',
        label: v.label ?? '',
        trainNumber,
        directionId: v.directionId,
        status: v.status,
        stopName: v.stopName,
      },
      lng: v.lng,
      lat: v.lat,
      props: {
        group,
        dataStatus: 'live',
        legendKey: 'mbta',
        legendLabel: 'MBTA',
        modeColor: baseColor,
        color: baseColor,
        shadeKey: v.route, // MBTA static routes use raw route ids
        bearing: v.bearing ?? 0,
        hasBearing: typeof v.bearing === 'number',
        stale: now - Date.parse(v.updatedAt) > CONFIG.STALE_AFTER_MS,
        title: titleFor(group, v.route, info),
        dest: info?.destinations?.[v.directionId]
          ? `to ${info.destinations[v.directionId]}`
          : '',
        status: formatStatus(v),
        meta: [
          trainNumber ? `train ${trainNumber}` : '',
          v.label ? `car ${v.label}` : '',
          v.occupancy.toLowerCase(),
        ]
          .filter(Boolean)
          .join(' · '),
        provider: 'MBTA V3 vehicle feed',
        sourceUrl: 'https://www.mbta.com/developers/v3-api',
        updatedAt: v.updatedAt,
      },
    });
  });

  const visible = fleet.update(items);
  for (const item of visible) {
    const group = item.props.group;
    byGroup[group] = (byGroup[group] ?? 0) + 1;
  }
  statsListeners.forEach((fn) => fn({ byGroup, lastUpdate: now }));
}
