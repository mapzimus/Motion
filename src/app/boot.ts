// App boot sequence. Near-mechanical port of js/app.js main() with poller
// callbacks targeting store setters instead of ui.*. DOM-only init calls
// (initPanel, applyVisibleState) still go through ui.js directly.

import { CONFIG } from '../feeds/config.js';
import { fetchRoutes } from '../feeds/api.js';
import { startMbta, onStats, onStatus } from '../feeds/mbta.js';
import { startAmtrak } from '../feeds/amtrak.js';
import { startPlanes } from '../feeds/planes.js';
import { startAis } from '../feeds/ais.js';
import { startRegional } from '../feeds/regional.js';
import { startSharedMobility } from '../feeds/shared-mobility.js';
import { startRoadwork } from '../feeds/roadwork.js';
import { startRoadConditions } from '../feeds/road-conditions.js';
import { startConditions } from '../feeds/conditions.js';
import { startMetroNorth } from '../feeds/metro-north.js';
import { startAlertPolling } from '../feeds/alerts.js';
import { initialRegion, loadRegions } from '../feeds/regions.js';
import { initPermalink, readPermalink, schedulePermalinkUpdate } from '../feeds/permalink.js';
import { initSearch, setSearchFeatures } from '../feeds/search.js';
import { fleetLabel } from '../feeds/trip-data.js';
import {
  configureGateway,
  fleetCountsForRegion,
  initMap,
  loadReferenceData,
  map,
  referenceCountsForRegion,
  scheduledRouteCountsForRegion,
  scheduledStationCountsForRegion,
  setRegion,
  setRouteShapes,
  setVehicleClickHandler,
  setVisibleGroups,
} from '../map/map.js';
import { follow, getSelection, initFollow } from '../follow/follow.js';
import { initTripCard, showToast } from '../trip-card.js';
import * as ui from '../ui.js';
import {
  setLoading,
  setFatal,
  updateCounts,
  replaceCounts,
  setScheduledCounts,
  setStationCounts,
  setReferenceCounts,
  setAlerts,
  updateStats,
  updateStatus,
} from '../stores/index.js';
import { loadShapeFeatures, loadRegionalRouteFeatures } from './shapes.js';

// ---------------------------------------------------------------------------
// Gateway health check
// ---------------------------------------------------------------------------

async function loadGatewayCapabilities(): Promise<Record<string, unknown>> {
  let capabilities: Record<string, unknown> = {};
  try {
    if (CONFIG.GATEWAY_BASE) {
      const response = await fetch(`${CONFIG.GATEWAY_BASE}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`gateway ${response.status}`);
      capabilities = ((await response.json()).providers as Record<string, unknown>) ?? {};
    }
  } catch (error: any) {
    console.warn('Motion gateway unavailable:', error.message);
  }

  try {
    if (CONFIG.AIRCRAFT_GATEWAY_BASE) {
      const response = await fetch(`${CONFIG.AIRCRAFT_GATEWAY_BASE}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      capabilities.aircraft = response.ok;
    }
  } catch (error: any) {
    console.warn('Motion aircraft gateway unavailable:', error.message);
    capabilities.aircraft = false;
  }

  return capabilities;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export async function boot(): Promise<void> {
  setLoading('LOADING NEW ENGLAND…');
  const [routes, , capabilities] = await Promise.all([
    fetchRoutes(),
    loadRegions(),
    loadGatewayCapabilities(),
  ]);
  const routeInfo = new Map(routes.map((r: any) => [r.id, r]));

  // A shared link (#r=...&c=...&z=...) wins over ?region= and the remembered region.
  const permalink = readPermalink();
  const selectedRegion = permalink.region ?? initialRegion();
  if (permalink.center) {
    CONFIG.MAP_CENTER = permalink.center;
    if (permalink.zoom !== undefined) CONFIG.MAP_ZOOM = permalink.zoom;
  }

  const regionalControllers: Array<{ setRegion: (r: string) => void }> = [];

  // Alert aggregation: each source writes to the store; the store's computed
  // signal handles sorting.
  const updateAlertSource = (source: string) => (alerts: unknown[]) => {
    setAlerts(source, alerts as any);
  };

  const changeRegion = (region: string) => {
    setRegion(region);
    setScheduledCounts(scheduledRouteCountsForRegion());
    setStationCounts(scheduledStationCountsForRegion());
    setReferenceCounts(referenceCountsForRegion());
    for (const [source, counts] of Object.entries(fleetCountsForRegion())) {
      replaceCounts(counts, source);
    }
    for (const controller of regionalControllers) controller.setRegion(region);
    schedulePermalinkUpdate();
  };

  // DOM-only init: still goes through ui.js directly (B1 bridge).
  ui.initPanel(
    routeInfo,
    (groups: string[], statuses: string[]) => {
      setVisibleGroups(groups, statuses);
      schedulePermalinkUpdate();
    },
    changeRegion,
    selectedRegion,
    capabilities,
  );
  if (permalink.on || permalink.off || permalink.statuses) ui.applyVisibleState(permalink);
  configureGateway(capabilities);

  setLoading('RENDERING BASEMAP…');
  await initMap();
  // A permalink already positioned the camera; only fit the region otherwise.
  setRegion(selectedRegion, { fit: !permalink.center });
  setVisibleGroups(ui.getVisibleGroups(), ui.getVisibleStatuses());
  initPermalink({
    map,
    getRegion: ui.getRegion,
    getDefaultGroups: ui.getDefaultGroups,
    getVisibleGroups: ui.getVisibleGroups,
    getVisibleStatuses: ui.getVisibleStatuses,
    getFollow: () => {
      const selection = getSelection();
      return selection ? { fleetId: selection.fleetId, id: selection.id } : null;
    },
  });

  // Follow mode.
  initTripCard();
  initFollow({ ensureVisible: ui.ensureGroupVisible, toast: showToast, fleetLabel });
  setVehicleClickHandler((fleetId: string, id: string) => {
    if (fleetId === 'bike') return false; // docks keep their popup
    follow(fleetId, id, { mode: getSelection()?.mode === 'following' ? 'following' : 'selected' });
    return true;
  });
  if (permalink.follow) follow(permalink.follow.fleetId, permalink.follow.id, { mode: 'following' });

  initSearch({
    onVehicle: (fleetId: string, id: string) => follow(fleetId, id, { mode: 'following' }),
    onRegion: (key: string) => ui.selectRegion(key),
  });
  loadReferenceData().then((counts: Record<string, number>) => setReferenceCounts(counts));

  // MBTA stats and status -> store setters.
  onStats((stats: any) => {
    updateStats(stats);
    if (stats.byGroup) updateCounts(stats.byGroup, 'mbta');
  });
  onStatus((state: string, detail?: any) => updateStatus(state, detail));

  setLoading('ACQUIRING LIVE FEEDS…');
  startMbta(routeInfo, ui.formatVehicleStatus);
  startAmtrak((counts: Record<string, number>) => updateCounts(counts, 'amtrak'));
  regionalControllers.push(
    startRegional(
      (counts: Record<string, number>) => updateCounts(counts, 'regional'),
      selectedRegion,
      capabilities.regionalTransit,
    ),
    startPlanes(
      (counts: Record<string, number>) => updateCounts(counts, 'planes'),
      selectedRegion,
      capabilities.aircraft,
    ),
    startAis(
      (counts: Record<string, number>) => updateCounts(counts, 'ais'),
      selectedRegion,
      capabilities.ais,
    ),
    startRoadwork(
      (counts: Record<string, number>) => updateCounts(counts, 'roadwork'),
      selectedRegion,
      capabilities.roadwork,
    ),
    startRoadConditions(
      (counts: Record<string, number>) => updateCounts(counts, 'road-conditions'),
      capabilities,
    ),
    startMetroNorth(
      (counts: Record<string, number>) => updateCounts(counts, 'mnr'),
      updateAlertSource('mnr'),
      selectedRegion,
      capabilities.metroNorth,
    ),
    startConditions(
      (counts: Record<string, number>) => updateCounts(counts, 'conditions'),
      updateAlertSource('nws'),
      selectedRegion,
      capabilities,
    ),
  );
  startSharedMobility((counts: Record<string, number>) => updateCounts(counts, 'shared-mobility'));
  regionalControllers.push(startAlertPolling(routeInfo, updateAlertSource('mbta')));

  // Route ribbons load after polling kicks off; vehicles shouldn't wait on
  // them. Every route gets a ribbon.
  const routeFeatureSets: GeoJSON.Feature[][] = [[], []];
  const publishRouteFeatures = () => {
    const features = routeFeatureSets.flat();
    setRouteShapes({ type: 'FeatureCollection', features });
    setSearchFeatures(features, routeInfo);
    setScheduledCounts(scheduledRouteCountsForRegion());
    setStationCounts(scheduledStationCountsForRegion());
    setVisibleGroups(ui.getVisibleGroups(), ui.getVisibleStatuses());
  };
  await Promise.allSettled([
    loadShapeFeatures(routes, routeInfo).then((features) => {
      routeFeatureSets[0] = features;
      publishRouteFeatures();
    }),
    loadRegionalRouteFeatures().then((features) => {
      routeFeatureSets[1] = features;
      publishRouteFeatures();
    }),
  ]);
}
