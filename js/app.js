// Orchestrator: routes -> map -> live feeds -> ribbons.

import { CONFIG } from './config.js';
import { fetchRoutes, fetchShapes } from './api.js';
import { decodePolyline } from './polyline.js';
import {
  configureGateway,
  fleetCountsForRegion,
  initMap,
  scheduledRouteCountsForRegion,
  setRegion,
  setRouteShapes,
  setVisibleGroups,
} from './map.js';
import { startMbta, groupFor, onStats, onStatus } from './mbta.js';
import { startAmtrak } from './amtrak.js';
import { startPlanes } from './planes.js';
import { startAis } from './ais.js';
import { startRegional } from './regional.js';
import { startSharedMobility } from './shared-mobility.js';
import { startRoadwork } from './roadwork.js';
import { startMetroNorth } from './metro-north.js';
import { startAlertPolling } from './alerts.js';
import { initialRegion, loadRegions } from './regions.js';
import * as ui from './ui.js';

async function loadGatewayCapabilities() {
  let capabilities = {};
  try {
    if (CONFIG.GATEWAY_BASE) {
      const response = await fetch(`${CONFIG.GATEWAY_BASE}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`gateway ${response.status}`);
      capabilities = (await response.json()).providers ?? {};
    }
  } catch (error) {
    console.warn('Motion gateway unavailable:', error.message);
  }

  try {
    if (CONFIG.AIRCRAFT_GATEWAY_BASE) {
      const response = await fetch(`${CONFIG.AIRCRAFT_GATEWAY_BASE}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      capabilities.aircraft = response.ok;
    }
  } catch (error) {
    console.warn('Motion aircraft gateway unavailable:', error.message);
    capabilities.aircraft = false;
  }

  return capabilities;
}

async function main() {
  ui.setLoading('LOADING NEW ENGLAND…');
  const [routes, , capabilities] = await Promise.all([
    fetchRoutes(),
    loadRegions(),
    loadGatewayCapabilities(),
  ]);
  const routeInfo = new Map(routes.map((r) => [r.id, r]));
  const selectedRegion = initialRegion();
  const regionalControllers = [];
  const alertsBySource = new Map();
  const updateAlerts = (source) => (alerts) => {
    alertsBySource.set(source, alerts);
    ui.renderAlerts(
      [...alertsBySource.values()].flat().sort((a, b) => b.severity - a.severity),
    );
  };
  const changeRegion = (region) => {
    setRegion(region);
    ui.setScheduledCounts(scheduledRouteCountsForRegion());
    for (const [source, counts] of Object.entries(fleetCountsForRegion())) {
      ui.replaceCounts(counts, source);
    }
    for (const controller of regionalControllers) controller.setRegion(region);
  };

  ui.initPanel(
    routeInfo,
    setVisibleGroups,
    changeRegion,
    selectedRegion,
    capabilities,
  );
  configureGateway(capabilities);

  ui.setLoading('RENDERING BASEMAP…');
  await initMap();
  setRegion(selectedRegion);
  setVisibleGroups(ui.getVisibleGroups());

  // Listeners registered before polling starts so the first tick lands in the UI.
  onStats(ui.updateStats);
  onStatus(ui.updateStatus);

  ui.setLoading('ACQUIRING LIVE FEEDS…');
  startMbta(routeInfo, ui.formatVehicleStatus);
  startAmtrak((counts) => ui.updateCounts(counts, 'amtrak'));
  regionalControllers.push(
    startRegional(
      (counts) => ui.updateCounts(counts, 'regional'),
      selectedRegion,
      capabilities.regionalTransit,
    ),
    startPlanes(
      (counts) => ui.updateCounts(counts, 'planes'),
      selectedRegion,
      capabilities.aircraft,
    ),
    startAis(
      (counts) => ui.updateCounts(counts, 'ais'),
      selectedRegion,
      capabilities.ais,
    ),
    startRoadwork(
      (counts) => ui.updateCounts(counts, 'roadwork'),
      selectedRegion,
      capabilities.roadwork,
    ),
    startMetroNorth(
      (counts) => ui.updateCounts(counts, 'mnr'),
      updateAlerts('mnr'),
      selectedRegion,
      capabilities.metroNorth,
    ),
  );
  startSharedMobility((counts) => ui.updateCounts(counts, 'shared-mobility'));
  regionalControllers.push(startAlertPolling(routeInfo, updateAlerts('mbta')));

  // Route ribbons load after polling kicks off; vehicles shouldn't wait on
  // them. Every route gets a ribbon — the ~150 bus routes render thin and
  // faint and toggle with the bus layer.
  setRouteShapes({
    type: 'FeatureCollection',
    features: (await Promise.all([
      loadShapeFeatures(routes, routeInfo),
      loadRegionalRouteFeatures(),
    ])).flat(),
  });
  ui.setScheduledCounts(scheduledRouteCountsForRegion());
  setVisibleGroups(ui.getVisibleGroups()); // re-apply to the fresh ribbon data
}

async function loadRegionalRouteFeatures() {
  try {
    const response = await fetch(CONFIG.REGIONAL_ROUTE_URL);
    if (!response.ok) throw new Error(`regional routes ${response.status}`);
    const collection = await response.json();
    return collection.features ?? [];
  } catch (error) {
    console.warn('Scheduled regional route ribbons unavailable:', error.message);
    return [];
  }
}

// Shapes are static geometry, but ~180 routes = ~180 requests on a cold load —
// so cache them for a day and survive partial failures (a missing ribbon heals
// on the next visit; vehicles render regardless). The cache stores ENCODED
// polylines: compact enough that even the whole bus network fits comfortably
// in localStorage, decoded fresh on each load (fast).
async function loadShapeFeatures(ribbonRoutes, routeInfo) {
  localStorage.removeItem('bim-shapes-v2'); // superseded cache format
  const routesKey = ribbonRoutes.map((r) => r.id).join(',');

  const buildFeatures = (sets) =>
    sets.flatMap((set) =>
      set.polylines.map((polyline) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: decodePolyline(polyline) },
        properties: {
          route: set.id,
          group: set.group,
          color: set.color,
          kind: 'mbta',
          regions: ['boston', 'ma'],
        },
      })),
    );

  try {
    const cached = JSON.parse(localStorage.getItem(CONFIG.SHAPE_CACHE_KEY));
    if (
      cached &&
      cached.routes === routesKey &&
      Date.now() - cached.at < CONFIG.SHAPE_CACHE_TTL_MS
    ) {
      return buildFeatures(cached.sets);
    }
  } catch {
    /* corrupt cache -> refetch */
  }

  const settled = await Promise.allSettled(
    ribbonRoutes.map(async (r) => ({
      id: r.id,
      group: groupFor(r.id, routeInfo.get(r.id)),
      color: routeInfo.get(r.id)?.color ?? '#8a939c',
      polylines: await fetchShapes(r.id),
    })),
  );
  const failed = ribbonRoutes.filter((_, i) => settled[i].status === 'rejected');
  if (failed.length) {
    console.warn(
      `Route ribbons unavailable this load: ${failed.map((r) => r.id).join(', ')}`,
    );
  }
  const sets = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);

  if (!failed.length) {
    try {
      localStorage.setItem(
        CONFIG.SHAPE_CACHE_KEY,
        JSON.stringify({ at: Date.now(), routes: routesKey, sets }),
      );
    } catch {
      /* storage full/blocked -> fine, just refetch next time */
    }
  }
  return buildFeatures(sets);
}

main().catch((err) => ui.fatal(err));
