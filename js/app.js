// Orchestrator: routes -> map -> live feeds -> ribbons.

import { CONFIG } from './config.js';
import { fetchRoutes, fetchShapes } from './api.js';
import { decodePolyline } from './polyline.js';
import { initMap, setRouteShapes, setVisibleGroups } from './map.js';
import { startMbta, groupFor, onStats, onStatus } from './mbta.js';
import { startAmtrak } from './amtrak.js';
import { startPlanes } from './planes.js';
import { startAis } from './ais.js';
import { startAlertPolling } from './alerts.js';
import * as ui from './ui.js';

async function main() {
  ui.setLoading('CONTACTING MBTA…');
  const routes = await fetchRoutes();
  const routeInfo = new Map(routes.map((r) => [r.id, r]));

  ui.initPanel(routeInfo, setVisibleGroups);

  ui.setLoading('RENDERING BASEMAP…');
  await initMap();
  setVisibleGroups(ui.getVisibleGroups());

  // Listeners registered before polling starts so the first tick lands in the UI.
  onStats(ui.updateStats);
  onStatus(ui.updateStatus);

  ui.setLoading('ACQUIRING LIVE FEEDS…');
  startMbta(routeInfo, ui.formatVehicleStatus);
  startAmtrak(ui.updateCounts);
  startPlanes(ui.updateCounts);
  startAis(ui.updateCounts);
  startAlertPolling(routeInfo, ui.renderAlerts);

  // Route ribbons load after polling kicks off; vehicles shouldn't wait on
  // them. Ribbons cover rail + Silver Line + ferries — not the ~150 bus
  // routes, which would bury the map.
  const ribbonRoutes = routes.filter(
    (r) => [0, 1, 2, 4].includes(r.type) || CONFIG.SILVER_ROUTES.includes(r.id),
  );
  setRouteShapes({
    type: 'FeatureCollection',
    features: await loadShapeFeatures(ribbonRoutes, routeInfo),
  });
  setVisibleGroups(ui.getVisibleGroups()); // re-apply to the fresh ribbon data
}

// Shapes are static geometry, but ~35 routes = ~35 requests — cache for a day
// and survive partial failures (a missing ribbon heals on the next visit;
// vehicles render regardless).
async function loadShapeFeatures(ribbonRoutes, routeInfo) {
  const routesKey = ribbonRoutes.map((r) => r.id).join(',');
  try {
    const cached = JSON.parse(localStorage.getItem(CONFIG.SHAPE_CACHE_KEY));
    if (
      cached &&
      cached.routes === routesKey &&
      Date.now() - cached.at < CONFIG.SHAPE_CACHE_TTL_MS
    ) {
      return cached.features;
    }
  } catch {
    /* corrupt cache -> refetch */
  }

  const settled = await Promise.allSettled(
    ribbonRoutes.map(async (r) => ({ id: r.id, polylines: await fetchShapes(r.id) })),
  );
  const failed = ribbonRoutes.filter((_, i) => settled[i].status === 'rejected');
  if (failed.length) {
    console.warn(
      `Route ribbons unavailable this load: ${failed.map((r) => r.id).join(', ')}`,
    );
  }

  const features = settled
    .filter((s) => s.status === 'fulfilled')
    .flatMap(({ value: { id, polylines } }) =>
      polylines.map((polyline) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: decodePolyline(polyline) },
        properties: {
          route: id,
          group: groupFor(id, routeInfo.get(id)),
          color: routeInfo.get(id)?.color ?? '#8a939c',
        },
      })),
    );

  if (!failed.length) {
    try {
      localStorage.setItem(
        CONFIG.SHAPE_CACHE_KEY,
        JSON.stringify({ at: Date.now(), routes: routesKey, features }),
      );
    } catch {
      /* storage full/blocked -> fine, just refetch next time */
    }
  }
  return features;
}

main().catch((err) => ui.fatal(err));
