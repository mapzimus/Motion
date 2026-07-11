// Vehicle poller + animation engine.
// Polls /vehicles on an interval, then glides each marker from its displayed
// position to the newly reported one over CONFIG.ANIMATE_MS, so trains appear
// to move continuously instead of teleporting every poll.

import { CONFIG } from './config.js';
import { fetchVehicles } from './api.js';
import { setVehicleData } from './map.js';

let latest = new Map(); // id -> latest vehicle record from the API
let displayed = new Map(); // id -> [lng, lat] currently drawn on screen
let routeInfo = new Map();
let formatStatus = () => '';

let animFrame = null;
let pollTimer = null;
let backoffMs = 0;

const statsListeners = [];
const statusListeners = [];
export const onStats = (fn) => statsListeners.push(fn);
export const onStatus = (fn) => statusListeners.push(fn);
const emitStats = () => {
  const byRoute = {};
  for (const v of latest.values()) byRoute[v.route] = (byRoute[v.route] ?? 0) + 1;
  const payload = { count: latest.size, byRoute, lastUpdate: Date.now() };
  statsListeners.forEach((fn) => fn(payload));
};
const emitStatus = (state, detail = {}) =>
  statusListeners.forEach((fn) => fn(state, detail));

export function startVehiclePolling(routes, statusFormatter) {
  routeInfo = routes;
  formatStatus = statusFormatter;

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
    applyUpdate(vehicles);
    emitStatus('live');
    pollTimer = setTimeout(poll, CONFIG.VEHICLE_POLL_MS);
  } catch (err) {
    // Exponential backoff keeps us polite toward the API when it's unhappy.
    backoffMs = Math.min(backoffMs ? backoffMs * 2 : CONFIG.VEHICLE_POLL_MS, 60_000);
    emitStatus('error', { retryInMs: backoffMs, message: err.message });
    pollTimer = setTimeout(poll, backoffMs);
  }
}

function applyUpdate(vehicles) {
  latest = new Map(vehicles.map((v) => [v.id, v]));

  const moves = [];
  for (const v of vehicles) {
    const from = displayed.get(v.id);
    const to = [v.lng, v.lat];
    if (!from) {
      displayed.set(v.id, to); // new train: appear in place, no glide-in
    } else if (from[0] !== to[0] || from[1] !== to[1]) {
      moves.push({ id: v.id, from: [...from], to });
    }
  }
  for (const id of [...displayed.keys()]) {
    if (!latest.has(id)) displayed.delete(id);
  }

  emitStats();
  if (moves.length) animate(moves);
  else render();
}

function animate(moves) {
  cancelAnimationFrame(animFrame);
  const t0 = performance.now();

  const step = (now) => {
    const t = Math.min((now - t0) / CONFIG.ANIMATE_MS, 1);
    const ease = 1 - (1 - t) ** 3; // easeOutCubic: fast start, gentle arrival
    for (const m of moves) {
      if (!displayed.has(m.id)) continue;
      displayed.set(m.id, [
        m.from[0] + (m.to[0] - m.from[0]) * ease,
        m.from[1] + (m.to[1] - m.from[1]) * ease,
      ]);
    }
    render();
    animFrame = t < 1 ? requestAnimationFrame(step) : null;
  };
  animFrame = requestAnimationFrame(step);
}

function render() {
  const now = Date.now();
  const features = [];
  for (const [id, v] of latest) {
    const pos = displayed.get(id);
    if (!pos) continue;
    const info = routeInfo.get(v.route) ?? {};
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: pos },
      properties: {
        id,
        route: v.route,
        color: info.color ?? '#8a939c',
        bearing: v.bearing ?? 0,
        hasBearing: typeof v.bearing === 'number',
        stale: now - Date.parse(v.updatedAt) > CONFIG.STALE_AFTER_MS,
        routeName: info.longName ?? v.route,
        destination: info.destinations?.[v.directionId] ?? '',
        statusText: formatStatus(v),
        label: v.label ?? '',
        occupancy: v.occupancy ?? '',
        updatedAt: v.updatedAt,
      },
    });
  }
  setVehicleData({ type: 'FeatureCollection', features });
}
