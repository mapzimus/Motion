// Orchestrator: routes -> map -> shapes -> live pollers.

import { CONFIG } from './config.js';
import { fetchRoutes, fetchShapes } from './api.js';
import { decodePolyline } from './polyline.js';
import { initMap, setRouteShapes, setVisibleRoutes } from './map.js';
import { startVehiclePolling, onStats, onStatus } from './vehicles.js';
import { startAlertPolling } from './alerts.js';
import * as ui from './ui.js';

async function main() {
  if (!CONFIG.API_KEY) {
    console.info(
      'Running anonymously (20 req/min). Add ?api_key=YOUR_KEY or set CONFIG.API_KEY — free keys at https://api-v3.mbta.com',
    );
  }

  ui.setLoading('CONTACTING MBTA…');
  const routes = await fetchRoutes();
  const routeInfo = new Map(routes.map((r) => [r.id, r]));

  ui.initPanel(routeInfo, setVisibleRoutes);

  ui.setLoading('RENDERING BASEMAP…');
  await initMap();

  // Listeners registered before polling starts so the first tick lands in the UI.
  onStats(ui.updateStats);
  onStatus(ui.updateStatus);

  ui.setLoading('ACQUIRING LIVE FEED…');
  startVehiclePolling(routeInfo, ui.formatVehicleStatus);
  startAlertPolling(ui.renderAlerts);

  // Route ribbons load after polling kicks off; trains shouldn't wait on them.
  setRouteShapes({
    type: 'FeatureCollection',
    features: await loadShapeFeatures(routeInfo),
  });
}

// Shapes are static geometry, but 14 routes = 14 requests against a
// 20/min anonymous budget — so cache for a day and survive partial failures
// (a missing ribbon heals on the next visit; trains render regardless).
async function loadShapeFeatures(routeInfo) {
  const routesKey = CONFIG.RAPID_TRANSIT_ROUTES.join(',');
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
    CONFIG.RAPID_TRANSIT_ROUTES.map(async (id) => ({
      id,
      polylines: await fetchShapes(id),
    })),
  );
  const failed = CONFIG.RAPID_TRANSIT_ROUTES.filter(
    (_, i) => settled[i].status === 'rejected',
  );
  if (failed.length) {
    console.warn(`Route ribbons unavailable this load: ${failed.join(', ')}`);
  }

  const features = settled
    .filter((s) => s.status === 'fulfilled')
    .flatMap(({ value: { id, polylines } }) =>
      polylines.map((polyline) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: decodePolyline(polyline) },
        properties: { route: id, color: routeInfo.get(id)?.color ?? '#8a939c' },
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
