// Map engine: MapLibre GL setup, route ribbons, one animated layer-pair per
// vehicle fleet, source-agnostic popups, and alert-focus navigation.

import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { CONFIG } from '../feeds/config.js';
import { AIRPORT_STATUS_LABELS } from '../model/legendConfig.js';
import { lookupFlightRoute } from '../feeds/flight-routes.js';
import { ageText } from '../feeds/age.js';
import { attachStopPredictions } from '../feeds/predictions.js';
import {
  DEFAULT_REGION,
  boundaryForRegion,
  boundsForRegion,
  containsPoint,
  featureTouchesRegion,
  fleetBoundaryOptions,
  filterFeatureCollection,
  filterSpatialFeatureCollection,
  maxZoomForRegion,
  setActiveRegion,
} from '../feeds/regions.js';
import { buildRouteKeyIndex, stampRouteColors } from '../model/routeColors.js';
import {
  setRouteKeyIndex,
  paletteAssignment,
  setLiveKeyCounts,
  setLegendZoom,
  setViewportRoutes,
  wantsViewportRoutes,
} from '../stores/legend.js';
import { countLiveKeys, viewportRoutesFromFeatures, VIEWPORT_ZOOM } from '../model/legendRows.js';
import { PALETTE, VESSEL_BANDS } from '../model/palette.js';
import { GLYPHS, iconName, parseIconName } from './glyphs.js';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// v6 ships ESM only. Vite does not leave import.meta.url pointing at the
// published worker, so the bundled worker URL has to be set before any map.
maplibregl.setWorkerUrl(workerUrl);

// Static routes and stops: operator color when zoomed out, per-route shade when
// zoomed in. Subway and Amtrak carry no opColor and keep their baked color.
const ROUTE_COLOR_EXPR = [
  'interpolate', ['linear'], ['zoom'],
  12.5, ['coalesce', ['get', 'opColor'], ['get', 'color']],
  13.5, ['coalesce', ['get', 'routeColor'], ['get', 'color']],
];
const ROUTE_COLOR_LAYERS = {
  'route-halo': 'line-color',
  'route-lines': 'line-color',
  'scheduled-station-halo': 'circle-color',
  'scheduled-stations': 'circle-color',
  'scheduled-ferry-stops': 'circle-color',
  'scheduled-bus-stops': 'circle-color',
};

/** Re-assert the route color expression (a basemap swap rebuilds the layers). */
export function applyRoutePalette() {
  if (!map || !layersReady) return;
  for (const [layerId, prop] of Object.entries(ROUTE_COLOR_LAYERS)) {
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, prop, ROUTE_COLOR_EXPR);
  }
}

// Draw order, bottom to top: bike docks under boats under trains under planes.
const FLEETS = ['bike', 'vessel', 'amtrak', 'regional', 'mnr', 'mbta', 'coaches', 'plane'];

// The visual language: SHAPE says what kind of vehicle it is, COLOR says whose
// service it is. Rail keeps the classic dot + heading chevron; every other
// mode gets its own silhouette so it reads at first glance.
const RAIL_GROUPS = ['red', 'orange', 'green', 'blue', 'silver', 'mattapan', 'commuter', 'amtrak'];
const ICON_GROUPS = ['bus', 'ferry', 'plane', 'vessel', 'bike'];
// Sprite color for a vehicle that arrives without one; drawn on first use by
// the missing-image resolver like any other icon-<shape>-<hex6> sprite.
const FALLBACK_ICON_COLOR = '#8a939c';
// Glyph shape per vehicle; shared mobility splits docks from free vehicles.
const ICON_SHAPE_EXPR = [
  'match', ['get', 'group'],
  'plane', ['match', ['get', 'planeKind'], 'light', 'plane-light', 'heli', 'plane-heli', 'other', 'plane-other', 'plane'],
  'bus', 'bus',
  'ferry', 'boat',
  'vessel', 'boat',
  ['match', ['get', 'markerKind'], 'scooter', 'share-scooter', 'bicycle', 'share-bike', 'dock'],
];
// Live rail dots: operator color zoomed out, route shade zoomed in.
const VEHICLE_COLOR_EXPR = [
  'interpolate', ['linear'], ['zoom'],
  12.5, ['get', 'color'],
  13.5, ['coalesce', ['get', 'routeColor'], ['get', 'color']],
];
const STOP_POINT_LAYERS = ['scheduled-stations', 'scheduled-ferry-stops', 'scheduled-bus-stops'];
const AIRPORT_LAYERS = ['airport-public-points', 'airport-private-points', 'airport-public-marks', 'airport-private-marks', 'airport-labels'];
const AIRPORT_CIRCLE_FILTER = ['!', ['in', ['get', 'facilityType'], ['literal', ['Heliport', 'Seaplane base']]]];

export let map;
let routeShapesFC = EMPTY_FC; // kept for alert-focus bounds math
let allRouteShapesFC = EMPTY_FC;
let pingMarker = null;
let pingTimer = null;
let trafficAvailable = false;
let allRoadworkFC = EMPTY_FC;
let roadworkFC = EMPTY_FC;
let allRoadEventsFC = EMPTY_FC;
let roadEventsFC = EMPTY_FC;
let allCamerasFC = EMPTY_FC;
let camerasFC = EMPTY_FC;
let allRoadWeatherFC = EMPTY_FC;
let roadWeatherFC = EMPTY_FC;
let allMessageSignsFC = EMPTY_FC;
let messageSignsFC = EMPTY_FC;
let allPlowsFC = EMPTY_FC;
let plowsFC = EMPTY_FC;
let allPlowRoutesFC = EMPTY_FC;
let plowRoutesFC = EMPTY_FC;
let plowRoutesPromise = null;
let allAerialwaysFC = EMPTY_FC;
let aerialwaysFC = EMPTY_FC;
let aerialwaysPromise = null;
let allInfrastructureFC = EMPTY_FC;
let infrastructureFC = EMPTY_FC;
let allLocalServicesFC = EMPTY_FC;
let localServicesFC = EMPTY_FC;
let allBikeshareFC = EMPTY_FC;
let bikeshareFC = EMPTY_FC;
let allAirportsFC = EMPTY_FC;
let airportsFC = EMPTY_FC;
let allBorderCrossingsFC = EMPTY_FC;
let borderCrossingsFC = EMPTY_FC;
let referenceLoadPromise = null;
// Reference catalogs load lazily; listeners refresh row counts when one lands.
const referenceDataHandlers = [];
export function onReferenceDataChange(handler) {
  referenceDataHandlers.push(handler);
}
const notifyReferenceData = () => referenceDataHandlers.forEach((handler) => handler());
// Reference places (heritage rail, park & ride, EV charging, drawbridges, taxis) are
// one ~5 MB file, so they load only when one of their groups is switched on.
const REFERENCE_PLACE_GROUPS = ['heritage-rail', 'park-ride', 'ev-charging', 'drawbridge', 'taxi'];
let allReferencePlacesFC = EMPTY_FC;
let referencePlacesFC = EMPTY_FC;
let referencePlacesPromise = null;
// Conditions layers (NWS weather polygons, FAA airport status rings).
let allWeatherFC = EMPTY_FC;
let weatherFC = EMPTY_FC;
let airportStatusPayload = { airports: [] };
let allAirportStatusFC = EMPTY_FC;
let airportStatusFC = EMPTY_FC;
// Aviation conditions (METAR dots, TFR polygons) and the lazily loaded FAA
// airspace reference file.
let allAirportWeatherFC = EMPTY_FC;
let airportWeatherFC = EMPTY_FC;
let allTfrFC = EMPTY_FC;
let tfrFC = EMPTY_FC;
let allAirspaceFC = EMPTY_FC;
let airspaceFC = EMPTY_FC;
let airspacePromise = null;

export function configureGateway(capabilities) {
  trafficAvailable = Boolean(capabilities?.traffic);
}

// ---- basemap ---------------------------------------------------------------
// setStyle() throws away every source, layer and image we added, so a swap
// rebuilds them on style.load and re-pushes the data held in module state.

const BASEMAP_STORAGE_KEY = 'motion-basemap';
let activeBasemap = null;

const basemapByKey = (key) => CONFIG.BASEMAPS.find((basemap) => basemap.key === key);

function initialBasemap() {
  const requested = new URLSearchParams(window.location.search).get('basemap');
  let saved = null;
  try {
    saved = localStorage.getItem(BASEMAP_STORAGE_KEY);
  } catch {
    // Storage blocked: fall through to the default.
  }
  return basemapByKey(requested) ? requested : basemapByKey(saved) ? saved : CONFIG.BASEMAPS[0].key;
}

// Resolved lazily so the panel can show the saved choice before the map exists.
export function getBasemap() {
  if (!activeBasemap) activeBasemap = initialBasemap();
  return activeBasemap;
}

export function setBasemap(key) {
  const basemap = basemapByKey(key);
  if (!basemap || key === activeBasemap) return;
  activeBasemap = key;
  try {
    localStorage.setItem(BASEMAP_STORAGE_KEY, key);
  } catch {
    // Private mode: keeping it for this visit is enough.
  }
  const url = new URL(window.location.href);
  if (key === CONFIG.BASEMAPS[0].key) url.searchParams.delete('basemap');
  else url.searchParams.set('basemap', key);
  history.replaceState(null, '', url);
  if (!map) return;
  layersReady = false;
  map.once('style.load', onStyleReady);
  // diff: false forces a full reload; a diffed swap strips our layers
  // without ever firing style.load.
  map.setStyle(basemap.style, { diff: false });
}

function onStyleReady() {
  setupLayers();
  layersReady = true;
  applyRoutePalette();
  if (pendingFilters) applyGroupFilter(pendingFilters.groups, pendingFilters.statuses);
  applyRegion(false);
}

export function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: basemapByKey(getBasemap()).style,
    center: CONFIG.MAP_CENTER,
    zoom: CONFIG.MAP_ZOOM,
    minZoom: 5,
    maxZoom: 17.5,
    maxBounds: CONFIG.MAP_BOUNDS,
    attributionControl: false,
    // v6 defaults this to 4, which changes vector-tile slicing and
    // queryRenderedFeatures. undefined keeps the 4.x overscale behavior the
    // legend's viewport route list depends on.
    zoomLevelsToOverscale: undefined,
  });
  window.__map = map; // console/debug access

  map.addControl(
    new maplibregl.AttributionControl({
      compact: true,
      customAttribution:
        'Data <a href="https://www.mbta.com/developers/v3-api" target="_blank" rel="noopener">MBTA</a> · <a href="https://www.mta.info/developers" target="_blank" rel="noopener">MTA Metro-North</a> · agency GTFS / <a href="https://mobilitydatabase.org" target="_blank" rel="noopener">Mobility Database</a> · <a href="https://content.amtrak.com/content/gtfs/GTFS.zip" target="_blank" rel="noopener">Amtrak schedule GTFS</a> / <a href="https://amtraker.com" target="_blank" rel="noopener">Amtraker live</a> · <a href="https://api.adsb.lol" target="_blank" rel="noopener">ADSB.lol</a> / <a href="https://adsb.fi" target="_blank" rel="noopener">adsb.fi</a> · <a href="https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/" target="_blank" rel="noopener">FAA NASR</a> · <a href="https://www.cbsa-asfc.gc.ca/do-rb/menu-eng.html" target="_blank" rel="noopener">CBSA</a> · MassDOT · GBFS · boundaries U.S. Census Bureau',
    }),
    'bottom-right',
  );
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  return new Promise((resolve) => {
    // style.load fires as soon as the style JSON is in; waiting for `load`
    // would also wait on the basemap's sprite and first tiles.
    map.once('style.load', () => {
      onStyleReady();
      // Layer click/hover listeners live on the map, not the style, so they
      // survive basemap swaps and are wired once.
      wirePopups();
      // v6 ignores addImage inside a styleimagemissing listener. The resolver
      // is what actually supplies a sprite the style asked for.
      map.setMissingStyleImageResolver(drawMissingIcon);
      wireLegend();
      resolve(map);
    });
  });
}

// White chevron pointing north; MapLibre rotates it per-feature by bearing.
function chevronImage(size = 48) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.06);
  ctx.lineTo(size * 0.84, size * 0.64);
  ctx.lineTo(size * 0.5, size * 0.48);
  ctx.lineTo(size * 0.16, size * 0.64);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

// ---- mode icon sprites -----------------------------------------------------
// Pre-rendered filled silhouettes wearing the same white outline as the rail
// dots. Shapes point north; MapLibre rotates them by live bearing.

function makeIcon(fill, draw, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#f4f6f8';
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

// Landing-facility marks, sized like the airport circles: a heliport is a
// filled disc with a dark "H"; a seaplane base is a hollow ring with a wave.
function facilityIcon(glyph, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  glyph(ctx, size / 64);
  return ctx.getImageData(0, 0, size, size);
}

function heliportGlyph(ctx, u) {
  ctx.beginPath();
  ctx.arc(32 * u, 32 * u, 24 * u, 0, Math.PI * 2);
  ctx.fillStyle = CONFIG.AIRPORT_COLOR;
  ctx.fill();
  ctx.lineWidth = 4 * u;
  ctx.strokeStyle = '#f4f6f8';
  ctx.stroke();
  ctx.fillStyle = '#10151b';
  ctx.fillRect(21 * u, 18 * u, 7 * u, 28 * u);
  ctx.fillRect(36 * u, 18 * u, 7 * u, 28 * u);
  ctx.fillRect(21 * u, 29 * u, 22 * u, 6 * u);
}

function seaplaneGlyph(ctx, u) {
  ctx.beginPath();
  ctx.arc(32 * u, 32 * u, 23 * u, 0, Math.PI * 2);
  ctx.fillStyle = '#10151b';
  ctx.fill();
  ctx.lineWidth = 7 * u;
  ctx.strokeStyle = CONFIG.AIRPORT_COLOR;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(17 * u, 33 * u);
  ctx.quadraticCurveTo(24.5 * u, 23 * u, 32 * u, 33 * u);
  ctx.quadraticCurveTo(39.5 * u, 43 * u, 47 * u, 33 * u);
  ctx.lineWidth = 5 * u;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// Light aircraft, helicopters and the rest draw a little smaller than airliners.
const planeIconSize = (airliner) => [
  'match', ['get', 'planeKind'],
  'light', airliner * 0.85,
  'heli', airliner * 0.9,
  'other', airliner * 0.75,
  airliner,
];

// Sprites are named icon-<shape>-<hex6> (glyphs.js). The common ones are
// drawn up front; route shades and overflow colors are drawn on first use by
// the missing-image resolver.
function registerModeIcons() {
  const bikeColors = CONFIG.SHARED_MOBILITY_SYSTEMS.map((system) => system.color).filter(Boolean);
  const preset = {
    plane: [CONFIG.PLANE_COLOR],
    'plane-light': [CONFIG.PLANE_COLOR],
    'plane-heli': [CONFIG.PLANE_COLOR],
    'plane-other': [CONFIG.PLANE_COLOR],
    bus: [CONFIG.BUS_COLOR, ...PALETTE],
    boat: [CONFIG.FERRY_COLOR, ...PALETTE, ...VESSEL_BANDS.map((band) => band.color)],
    dock: [CONFIG.BIKE_COLOR, CONFIG.BIKE_LOW_COLOR, CONFIG.BIKE_EMPTY_COLOR, ...bikeColors],
    'share-bike': [CONFIG.BIKE_FREE_COLOR, ...bikeColors],
    'share-scooter': [CONFIG.BIKE_FREE_COLOR, ...bikeColors],
  };
  for (const [shape, colors] of Object.entries(preset)) {
    for (const color of new Set(colors)) {
      addImageOnce(iconName(shape, color), makeIcon(color, GLYPHS[shape]));
    }
  }
  addImageOnce('icon-heliport', facilityIcon(heliportGlyph));
  addImageOnce('icon-seaplane-base', facilityIcon(seaplaneGlyph));
}

function drawMissingIcon(id) {
  const sprite = parseIconName(id);
  if (!sprite || map.hasImage(id)) return;
  map.addImage(id, makeIcon(sprite.color, GLYPHS[sprite.shape]), { pixelRatio: 2 });
}

// setStyle() can carry images over from the previous style; re-adding one
// that exists throws, which would abort the rest of the layer setup.
function addImageOnce(name, image) {
  if (map.hasImage(name)) map.removeImage(name);
  map.addImage(name, image, { pixelRatio: 2 });
}

function setupLayers() {
  addImageOnce('nav-chevron', chevronImage());
  registerModeIcons();

  // Live congestion raster under everything else we draw. The gateway uses
  // the public New England 511 speed service when no optional TomTom key is
  // configured.
  if (CONFIG.TRAFFIC_TILE_TEMPLATE && trafficAvailable) {
    map.addSource('traffic-flow', {
      type: 'raster',
      tiles: [CONFIG.TRAFFIC_TILE_TEMPLATE],
      tileSize: 256,
      attribution: 'Traffic speeds · public 511 services / IBI',
    });
    map.addLayer({
      id: 'traffic-flow',
      type: 'raster',
      source: 'traffic-flow',
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0.7 },
    });
  }

  for (const [id, tiles, attribution, opacity] of [
    ['walking-routes', CONFIG.WALK_TILE_TEMPLATE, 'Walking routes © OpenStreetMap contributors · Waymarked Trails', 0.8],
    ['cycling-routes', CONFIG.CYCLE_TILE_TEMPLATE, 'Cycling routes © OpenStreetMap contributors · Waymarked Trails', 0.8],
  ]) {
    if (!tiles) continue;
    map.addSource(id, { type: 'raster', tiles: [tiles], tileSize: 256, attribution });
    map.addLayer({
      id,
      type: 'raster',
      source: id,
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': opacity },
    });
  }

  map.addSource('region-boundary', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'region-boundary-fill',
    type: 'fill',
    source: 'region-boundary',
    paint: {
      'fill-color': '#9aa3ad',
      'fill-opacity': 0.025,
    },
  });
  map.addLayer({
    id: 'region-boundary-line',
    type: 'line',
    source: 'region-boundary',
    paint: {
      'line-color': '#c6ccd3',
      'line-opacity': 0.45,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 12, 1.8],
      'line-dasharray': [3, 2],
    },
  });

  map.addSource('infrastructure', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'major-roads-halo',
    type: 'line',
    source: 'infrastructure',
    filter: ['==', ['get', 'group'], 'roads'],
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': CONFIG.ROAD_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 13, 8],
      'line-opacity': 0.14,
      'line-blur': 2,
    },
  });
  map.addLayer({
    id: 'major-roads-lines',
    type: 'line',
    source: 'infrastructure',
    filter: ['==', ['get', 'group'], 'roads'],
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': CONFIG.ROAD_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 13, 2.5],
      'line-opacity': 0.7,
    },
  });
  map.addLayer({
    id: 'freight-rail-lines',
    type: 'line',
    source: 'infrastructure',
    filter: ['==', ['get', 'group'], 'freight'],
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': CONFIG.FREIGHT_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 13, 2.8],
      'line-opacity': 0.78,
      'line-dasharray': [2, 1],
    },
  });

  map.addSource('local-services', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'local-service-points',
    type: 'circle',
    source: 'local-services',
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.5, 12, 7],
      'circle-stroke-color': '#f4f6f8',
      'circle-stroke-width': 1.2,
      'circle-opacity': 0.9,
    },
  });

  // Bike-share systems with no public feed: one marker per town, labeled so
  // the operator reads off the map the way airports and water taxis do.
  map.addSource('bikeshare-systems', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'bikeshare-points',
    type: 'circle',
    source: 'bikeshare-systems',
    filter: ['==', ['get', 'group'], 'bikeshare'],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': CONFIG.BIKESHARE_REF_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.5, 12, 7],
      'circle-stroke-color': '#151a21',
      'circle-stroke-width': 1.4,
      'circle-opacity': 0.92,
    },
  });
  map.addLayer({
    id: 'bikeshare-labels',
    type: 'symbol',
    source: 'bikeshare-systems',
    filter: ['==', ['get', 'group'], 'bikeshare'],
    minzoom: 8,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'title'],
      'text-size': 10,
      'text-offset': [0, 1.3],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': CONFIG.BIKESHARE_REF_COLOR,
      'text-halo-color': '#10151b',
      'text-halo-width': 1.5,
    },
  });

  // Airports (and the rare ultralight field or balloonport) are circles;
  // heliports and seaplane bases get their own marks.
  map.addSource('airports', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'airport-public-points',
    type: 'circle',
    source: 'airports',
    filter: ['all', ['==', ['get', 'facilityUse'], 'public'], AIRPORT_CIRCLE_FILTER],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': CONFIG.AIRPORT_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 12, 6.5],
      'circle-stroke-color': '#f4f6f8',
      'circle-stroke-width': 1.1,
      'circle-opacity': 0.85,
    },
  });
  map.addLayer({
    id: 'airport-private-points',
    type: 'circle',
    source: 'airports',
    minzoom: 9,
    filter: ['all', ['==', ['get', 'facilityUse'], 'private'], AIRPORT_CIRCLE_FILTER],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': CONFIG.AIRPORT_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2, 14, 5],
      'circle-stroke-color': '#151a21',
      'circle-stroke-width': 1,
      'circle-opacity': 0.58,
    },
  });
  for (const [id, use, minzoom, sizes, opacity] of [
    ['airport-public-marks', 'public', 0, [5, 0.24, 12, 0.56], 0.95],
    ['airport-private-marks', 'private', 9, [9, 0.2, 14, 0.42], 0.7],
  ]) {
    map.addLayer({
      id,
      type: 'symbol',
      source: 'airports',
      minzoom,
      filter: ['all', ['==', ['get', 'facilityUse'], use], ['!', AIRPORT_CIRCLE_FILTER]],
      layout: {
        visibility: 'none',
        'icon-image': ['match', ['get', 'facilityType'], 'Heliport', 'icon-heliport', 'icon-seaplane-base'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], ...sizes],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': opacity },
    });
  }
  map.addLayer({
    id: 'airport-labels',
    type: 'symbol',
    source: 'airports',
    minzoom: 8,
    filter: ['==', ['get', 'facilityUse'], 'public'],
    layout: {
      visibility: 'none',
      'text-field': ['get', 'faaId'],
      'text-size': 10,
      'text-offset': [0, 1.1],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': CONFIG.AIRPORT_COLOR,
      'text-halo-color': '#10151b',
      'text-halo-width': 1.5,
    },
  });

  map.addSource('border-crossings', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'border-crossing-points',
    type: 'circle',
    source: 'border-crossings',
    layout: { visibility: 'none' },
    paint: {
      'circle-color': CONFIG.BORDER_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 11, 7],
      'circle-stroke-color': '#151a21',
      'circle-stroke-width': 1.2,
      'circle-opacity': 0.92,
    },
  });
  map.addLayer({
    id: 'border-crossing-labels',
    type: 'symbol',
    source: 'border-crossings',
    minzoom: 8,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'usPort'],
      'text-size': 10,
      'text-offset': [0, 1.2],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': CONFIG.BORDER_COLOR,
      'text-halo-color': '#10151b',
      'text-halo-width': 1.5,
    },
  });

  map.addSource('reference-places', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'heritage-rail-lines',
    type: 'line',
    source: 'reference-places',
    filter: ['==', ['get', 'group'], 'heritage-rail'],
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': CONFIG.HERITAGE_RAIL_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.6, 13, 4.5],
      'line-opacity': 0.9,
      'line-dasharray': [1.5, 1],
    },
  });
  map.addLayer({
    id: 'heritage-rail-labels',
    type: 'symbol',
    source: 'reference-places',
    filter: ['==', ['get', 'group'], 'heritage-rail'],
    minzoom: 8,
    layout: {
      visibility: 'none',
      'symbol-placement': 'line',
      'text-field': ['get', 'title'],
      'text-size': 10,
      'text-max-angle': 30,
    },
    paint: {
      'text-color': CONFIG.HERITAGE_RAIL_COLOR,
      'text-halo-color': '#10151b',
      'text-halo-width': 1.5,
    },
  });
  map.addLayer({
    id: 'park-ride-points',
    type: 'circle',
    source: 'reference-places',
    filter: ['==', ['get', 'group'], 'park-ride'],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': CONFIG.PARK_RIDE_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 11, 6.5],
      'circle-stroke-color': '#151a21',
      'circle-stroke-width': 1.2,
      'circle-opacity': 0.9,
    },
  });
  // EV charging is dense (~8,000 stations): zoomed out it draws as a density
  // heatmap (DC fast counts double), which fades into the stations by zoom 11.
  map.addLayer({
    id: 'ev-charging-heat',
    type: 'heatmap',
    source: 'reference-places',
    filter: ['==', ['get', 'group'], 'ev-charging'],
    maxzoom: 11,
    layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': ['case', ['get', 'fastCharge'], 2, 1],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.08, 8, 0.2, 10, 0.45],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 6, 8, 14, 10, 22],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(46, 125, 92, 0)',
        0.1, 'rgba(46, 125, 92, 0.3)',
        0.35, 'rgba(78, 185, 130, 0.5)',
        0.65, 'rgba(110, 231, 168, 0.7)',
        0.9, 'rgba(198, 249, 222, 0.85)',
        1, 'rgba(244, 255, 249, 0.9)',
      ],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.85, 11, 0],
    },
  });
  map.addLayer({
    id: 'ev-charging-points',
    type: 'circle',
    source: 'reference-places',
    filter: ['==', ['get', 'group'], 'ev-charging'],
    minzoom: 9,
    layout: { visibility: 'none' },
    paint: {
      'circle-color': CONFIG.EV_CHARGING_COLOR,
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        10, ['case', ['get', 'fastCharge'], 4, 2.5],
        14, ['case', ['get', 'fastCharge'], 7, 4.5],
      ],
      'circle-stroke-color': ['case', ['get', 'fastCharge'], '#f4f6f8', '#151a21'],
      'circle-stroke-width': 1.2,
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 10, 0.88],
      'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 10, 1],
    },
  });
  map.addLayer({
    id: 'drawbridge-points',
    type: 'circle',
    source: 'reference-places',
    filter: ['==', ['get', 'group'], 'drawbridge'],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': '#151a21',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 11, 7],
      'circle-stroke-color': CONFIG.DRAWBRIDGE_COLOR,
      'circle-stroke-width': 2.2,
      'circle-opacity': 0.95,
    },
  });
  map.addLayer({
    id: 'drawbridge-labels',
    type: 'symbol',
    source: 'reference-places',
    filter: ['==', ['get', 'group'], 'drawbridge'],
    minzoom: 9,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'title'],
      'text-size': 10,
      'text-offset': [0, 1.3],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': CONFIG.DRAWBRIDGE_COLOR,
      'text-halo-color': '#10151b',
      'text-halo-width': 1.5,
    },
  });
  // Taxi and cab services are a directory: companies sit on their garage or
  // city point, stands (smaller dots) on the curb where cabs queue.
  map.addLayer({
    id: 'taxi-points',
    type: 'circle',
    source: 'reference-places',
    filter: ['==', ['get', 'group'], 'taxi'],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': CONFIG.TAXI_COLOR,
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        5, ['case', ['==', ['get', 'kind'], 'stand'], 2, 3],
        12, ['case', ['==', ['get', 'kind'], 'stand'], 4.5, 7],
      ],
      'circle-stroke-color': '#151a21',
      'circle-stroke-width': 1.6,
      'circle-opacity': 0.95,
    },
  });
  map.addLayer({
    id: 'taxi-labels',
    type: 'symbol',
    source: 'reference-places',
    filter: ['==', ['get', 'group'], 'taxi'],
    minzoom: 10,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'title'],
      'text-size': 10,
      'text-offset': [0, 1.2],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': CONFIG.TAXI_COLOR,
      'text-halo-color': '#10151b',
      'text-halo-width': 1.5,
    },
  });

  map.addSource('road-events', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'incident-points',
    type: 'circle',
    source: 'road-events',
    paint: {
      'circle-color': CONFIG.INCIDENT_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4.5, 13, 9],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.92,
    },
  });

  map.addSource('road-weather', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'road-weather-points',
    type: 'circle',
    source: 'road-weather',
    layout: { visibility: 'none' },
    paint: {
      'circle-color': CONFIG.ROAD_WEATHER_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.2, 13, 6.5],
      'circle-stroke-color': '#151a21',
      'circle-stroke-width': 1.4,
      'circle-opacity': 0.92,
    },
  });

  map.addSource('message-signs', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'message-sign-points',
    type: 'circle',
    source: 'message-signs',
    layout: { visibility: 'none' },
    paint: {
      'circle-color': '#151a21',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 13, 6],
      'circle-stroke-color': CONFIG.MESSAGE_SIGN_COLOR,
      'circle-stroke-width': 1.8,
      'circle-opacity': 0.92,
    },
  });

  map.addSource('plows', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'plow-points',
    type: 'circle',
    source: 'plows',
    layout: { visibility: 'none' },
    paint: {
      'circle-color': CONFIG.PLOW_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 13, 8],
      'circle-stroke-color': '#151a21',
      'circle-stroke-width': 1.6,
      'circle-opacity': 0.95,
    },
  });

  map.addSource('plow-routes', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'plow-route-lines',
    type: 'line',
    source: 'plow-routes',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': CONFIG.PLOW_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 2.2],
      'line-opacity': 0.55,
    },
  });

  map.addSource('aerialways', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'aerialway-lines',
    type: 'line',
    source: 'aerialways',
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': CONFIG.AERIALWAY_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 14, 3.5],
      'line-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'aerialway-labels',
    type: 'symbol',
    source: 'aerialways',
    minzoom: 12,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'title'],
      'text-size': 11,
      'symbol-placement': 'line',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': CONFIG.AERIALWAY_COLOR,
      'text-halo-color': '#10151b',
      'text-halo-width': 1.4,
    },
  });

  map.addSource('cameras', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'camera-points',
    type: 'circle',
    source: 'cameras',
    paint: {
      'circle-color': '#151a21',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 13, 6.5],
      'circle-stroke-color': CONFIG.CAMERA_COLOR,
      'circle-stroke-width': 1.8,
      'circle-opacity': 0.9,
    },
  });

  map.addSource('roadwork', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'roadwork-areas',
    type: 'fill',
    source: 'roadwork',
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    layout: { visibility: 'none' },
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': 0.28,
    },
  });
  map.addLayer({
    id: 'roadwork-area-outline',
    type: 'line',
    source: 'roadwork',
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    layout: { visibility: 'none' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 14, 2.5],
      'line-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'roadwork-halo',
    type: 'line',
    source: 'roadwork',
    filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 4, 14, 12],
      'line-opacity': 0.2,
      'line-blur': 3,
    },
  });
  map.addLayer({
    id: 'roadwork-lines',
    type: 'line',
    source: 'roadwork',
    filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
    layout: {
      visibility: 'none',
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 14, 5],
      'line-opacity': ['case', ['get', 'active'], 0.95, 0.55],
      'line-dasharray': [2, 1],
    },
  });
  map.addLayer({
    id: 'roadwork-points',
    type: 'circle',
    source: 'roadwork',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': '#151a21',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.5, 13, 7],
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-opacity': 0.95,
    },
  });

  map.addSource('route-shapes', { type: 'geojson', data: EMPTY_FC });

  map.addLayer({
    id: 'route-halo',
    type: 'line',
    source: 'route-shapes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ROUTE_COLOR_EXPR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 14],
      'line-opacity': 0.18,
      'line-blur': 4,
    },
  });
  map.addLayer({
    id: 'route-lines',
    type: 'line',
    source: 'route-shapes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ROUTE_COLOR_EXPR,
      // Dense bus ribbons and straight-line air-service references stay subtle
      // so they inform without burying rail and water routes.
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, ['match', ['get', 'group'], 'bus', 0.7, 'air-service', 0.8, 1.8],
        15, ['match', ['get', 'group'], 'bus', 2.2, 'air-service', 2.2, 4.5],
      ],
      'line-opacity': ['match', ['get', 'group'], 'bus', 0.45, 'air-service', 0.42, 0.9],
    },
  });
  map.addLayer({
    id: 'scheduled-station-halo',
    type: 'circle',
    source: 'route-shapes',
    filter: [
      'all',
      ['==', ['get', 'kind'], 'regional-station'],
      ['in', ['get', 'group'], ['literal', RAIL_GROUPS]],
    ],
    paint: {
      'circle-color': ROUTE_COLOR_EXPR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5.5, 10, 9, 14, 14],
      'circle-opacity': 0.16,
      'circle-blur': 0.55,
    },
  });
  map.addLayer({
    id: 'scheduled-stations',
    type: 'circle',
    source: 'route-shapes',
    filter: [
      'all',
      ['==', ['get', 'kind'], 'regional-station'],
      ['in', ['get', 'group'], ['literal', RAIL_GROUPS]],
    ],
    paint: {
      'circle-color': ROUTE_COLOR_EXPR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.2, 10, 5.4, 14, 8],
      'circle-stroke-color': '#f4f6f8',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 14, 1.8],
      'circle-opacity': 0.9,
      'circle-stroke-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'scheduled-station-labels',
    type: 'symbol',
    source: 'route-shapes',
    minzoom: 8,
    maxzoom: 14,
    filter: [
      'all',
      ['==', ['get', 'kind'], 'regional-station'],
      ['in', ['get', 'group'], ['literal', RAIL_GROUPS]],
    ],
    layout: {
      'text-field': ['get', 'title'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 13, 11.5],
      'text-offset': [0, 1.15],
      'text-anchor': 'top',
      'text-max-width': 12,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#e8eaed',
      'text-halo-color': '#0b0f14',
      'text-halo-width': 1.6,
    },
  });
  map.addLayer({
    id: 'scheduled-station-labels-close',
    type: 'symbol',
    source: 'route-shapes',
    minzoom: 14,
    filter: [
      'all',
      ['==', ['get', 'kind'], 'regional-station'],
      ['in', ['get', 'group'], ['literal', RAIL_GROUPS]],
    ],
    layout: {
      'text-field': ['get', 'title'],
      'text-size': 10.5,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-max-width': 12,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#f4f6f8',
      'text-halo-color': '#0b0f14',
      'text-halo-width': 1.8,
    },
  });
  map.addLayer({
    id: 'scheduled-ferry-stops',
    type: 'circle',
    source: 'route-shapes',
    minzoom: 8.5,
    filter: [
      'all',
      ['==', ['get', 'kind'], 'regional-station'],
      ['==', ['get', 'group'], 'ferry'],
    ],
    paint: {
      'circle-color': ROUTE_COLOR_EXPR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8.5, 2.5, 14, 5],
      'circle-stroke-color': '#f4f6f8',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8.5, 0.7, 14, 1.3],
      'circle-opacity': 0.88,
    },
  });
  map.addLayer({
    id: 'scheduled-ferry-stop-labels',
    type: 'symbol',
    source: 'route-shapes',
    minzoom: 10,
    filter: [
      'all',
      ['==', ['get', 'kind'], 'regional-station'],
      ['==', ['get', 'group'], 'ferry'],
    ],
    layout: {
      'text-field': ['get', 'title'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 8, 15, 10],
      'text-offset': [0, 1.05],
      'text-anchor': 'top',
      'text-max-width': 11,
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': '#bdeef3',
      'text-halo-color': '#0b0f14',
      'text-halo-width': 1.4,
    },
  });
  map.addLayer({
    id: 'scheduled-bus-stops',
    type: 'circle',
    source: 'route-shapes',
    minzoom: 12.5,
    filter: [
      'all',
      ['==', ['get', 'kind'], 'regional-station'],
      ['==', ['get', 'group'], 'bus'],
    ],
    paint: {
      'circle-color': ROUTE_COLOR_EXPR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12.5, 1.2, 16, 2.6],
      'circle-stroke-color': '#10151c',
      'circle-stroke-width': 0.55,
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0.42, 15, 0.78],
    },
  });
  map.addLayer({
    id: 'scheduled-bus-stop-labels',
    type: 'symbol',
    source: 'route-shapes',
    minzoom: 14.25,
    filter: [
      'all',
      ['==', ['get', 'kind'], 'regional-station'],
      ['==', ['get', 'group'], 'bus'],
    ],
    layout: {
      'text-field': ['get', 'title'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14.25, 7.5, 17, 9],
      'text-offset': [0, 0.9],
      'text-anchor': 'top',
      'text-max-width': 9,
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': 'rgba(231, 222, 186, 0.82)',
      'text-halo-color': 'rgba(11, 15, 20, 0.94)',
      'text-halo-width': 1.1,
    },
  });

  for (const fleetId of FLEETS) {
    map.addSource(`veh-${fleetId}`, { type: 'geojson', data: EMPTY_FC, promoteId: 'id' });
    if (fleetId === 'plane') {
      // A red ring under any aircraft squawking 7500/7600/7700 or reporting
      // an emergency status. It sits below the silhouette so the icon stays legible.
      map.addLayer({
        id: 'veh-plane-emergency',
        type: 'circle',
        source: 'veh-plane',
        filter: ['==', ['get', 'emergency'], true],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 15, 20],
          'circle-color': CONFIG.AIRCRAFT_EMERGENCY_COLOR,
          'circle-opacity': 0.18,
          'circle-stroke-color': CONFIG.AIRCRAFT_EMERGENCY_COLOR,
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 15, 3],
          'circle-stroke-opacity': 0.95,
        },
      });
    }
    map.addLayer({
      id: `veh-${fleetId}-dots`,
      type: 'circle',
      source: `veh-${fleetId}`,
      filter: ['in', ['get', 'group'], ['literal', RAIL_GROUPS]],
      paint: {
        'circle-color': VEHICLE_COLOR_EXPR,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 12, 6, 15, 10],
        'circle-stroke-color': '#f4f6f8',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 15, 2],
        'circle-opacity': ['case', ['get', 'stale'], 0.35, 1],
        'circle-stroke-opacity': ['case', ['get', 'stale'], 0.35, 1],
      },
    });
    map.addLayer({
      id: `veh-${fleetId}-arrows`,
      type: 'symbol',
      source: `veh-${fleetId}`,
      filter: [
        'all',
        ['in', ['get', 'group'], ['literal', RAIL_GROUPS]],
        ['==', ['get', 'hasBearing'], true],
      ],
      layout: {
        'icon-image': 'nav-chevron',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.3, 15, 0.65],
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // Sits just ahead of the dot; the offset rotates with the bearing.
        'icon-offset': [0, -36],
      },
      paint: { 'icon-opacity': ['case', ['get', 'stale'], 0.3, 0.95] },
    });
    map.addLayer({
      id: `veh-${fleetId}-icons`,
      type: 'symbol',
      source: `veh-${fleetId}`,
      filter: ['in', ['get', 'group'], ['literal', ICON_GROUPS]],
      layout: {
        'icon-image': [
          'step', ['zoom'],
          ['concat', 'icon-', ICON_SHAPE_EXPR, '-', ['slice', ['coalesce', ['get', 'color'], FALLBACK_ICON_COLOR], 1]],
          13.5, ['concat', 'icon-', ICON_SHAPE_EXPR, '-', ['slice', ['coalesce', ['get', 'routeColor'], ['get', 'color'], FALLBACK_ICON_COLOR], 1]],
        ],
        'icon-size': [
          'interpolate', ['linear'], ['zoom'],
          9, ['match', ['get', 'group'], 'plane', planeIconSize(0.38), 'bike', 0.2, 0.3],
          15, ['match', ['get', 'group'], 'plane', planeIconSize(0.8), 'bike', 0.5, 0.7],
        ],
        'icon-rotate': ['case', ['get', 'hasBearing'], ['get', 'bearing'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['case', ['get', 'stale'], 0.35, 1] },
    });
  }
  // Operational point layers remain clickable above route ribbons and dense
  // infrastructure without covering moving vehicle symbols.
  for (const layerId of ['local-service-points', 'bikeshare-points', 'camera-points', 'incident-points', 'road-weather-points', 'message-sign-points', 'plow-points', 'roadwork-points']) {
    map.moveLayer(layerId, 'veh-bike-dots');
  }
  setupConditionLayers();
  setupSelectedLayers();
}

// ---- selected vehicle ------------------------------------------------------
// One unclipped point drawn above every fleet: the vehicle being followed.
// It ignores region clipping and layer toggles on purpose, so a followed
// train stays visible after it leaves the selected geography.

function setupSelectedLayers() {
  map.addSource('veh-selected', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'veh-selected-halo',
    type: 'circle',
    source: 'veh-selected',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'pulse'], 0, 13, 1, 26],
      'circle-color': ['get', 'color'],
      'circle-opacity': ['interpolate', ['linear'], ['get', 'pulse'], 0, 0.28, 1, 0],
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-opacity': ['interpolate', ['linear'], ['get', 'pulse'], 0, 0.9, 1, 0],
    },
  });
  map.addLayer({
    id: 'veh-selected-dot',
    type: 'circle',
    source: 'veh-selected',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 6, 12, 8, 15, 11],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
      'circle-opacity': ['case', ['get', 'stale'], 0.55, 1],
    },
  });
}

export function setSelectedFeature(lngLat, properties = null) {
  const source = map?.getSource('veh-selected');
  if (!source) return;
  if (!lngLat || !properties) {
    source.setData(EMPTY_FC);
    return;
  }
  source.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: lngLat },
      properties: {
        color: properties.color || '#2f80ed',
        stale: Boolean(properties.stale),
        pulse: properties.pulse ?? 0,
      },
    }],
  });
}

// Vehicle clicks go to follow mode first; returning true suppresses the
// legacy popup. Camera takeovers (region fit, alert focus, layer zoom,
// search fly-to) tell follow mode to let go of the camera.
let vehicleClickHandler = null;
export function setVehicleClickHandler(fn) {
  vehicleClickHandler = fn;
}
const cameraTakeoverHandlers = new Set();
export function onCameraTakeover(fn) {
  cameraTakeoverHandlers.add(fn);
  return () => cameraTakeoverHandlers.delete(fn);
}
export function takeCamera(reason) {
  cameraTakeoverHandlers.forEach((fn) => fn(reason));
}

// ---- conditions layers -----------------------------------------------------
// Weather polygons sit under every road/route line; airport-status rings sit
// with the other operational points, just below moving vehicles.
function setupConditionLayers() {
  map.addSource('weather-alerts', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'weather-alert-fill',
    type: 'fill',
    source: 'weather-alerts',
    layout: { visibility: 'none' },
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['match', ['get', 'severity'], 'Extreme', 0.3, 'Severe', 0.24, 'Moderate', 0.18, 0.12],
    },
  }, 'major-roads-halo');
  map.addLayer({
    id: 'weather-alert-outline',
    type: 'line',
    source: 'weather-alerts',
    layout: { visibility: 'none', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 12, 2],
      'line-opacity': 0.7,
      'line-dasharray': [3, 2],
    },
  }, 'major-roads-halo');

  map.addSource('airport-status', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'airport-status-halo',
    type: 'circle',
    source: 'airport-status',
    layout: { visibility: 'none' },
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 14, 12, 30],
      'circle-opacity': 0.16,
      'circle-blur': 0.6,
    },
  }, 'veh-bike-dots');
  map.addLayer({
    id: 'airport-status-rings',
    type: 'circle',
    source: 'airport-status',
    layout: { visibility: 'none' },
    paint: {
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.12,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 9, 12, 20],
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 3.5],
      'circle-stroke-opacity': 0.95,
    },
  }, 'veh-bike-dots');
  map.addLayer({
    id: 'airport-status-labels',
    type: 'symbol',
    source: 'airport-status',
    layout: {
      visibility: 'none',
      'text-field': ['get', 'badge'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9, 12, 12],
      'text-offset': [0, -1.9],
      'text-anchor': 'bottom',
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': ['get', 'color'],
      'text-halo-color': '#10151b',
      'text-halo-width': 1.6,
    },
  }, 'veh-bike-dots');
  setupAviationLayers();
}

// Charted airspace and TFRs sit with the weather polygons under every road
// and route line (TFRs above airspace); METAR dots sit with the airport-status
// rings just below moving vehicles.
const flightCategoryColor = () => [
  'match', ['get', 'flightCategory'],
  'VFR', CONFIG.FLIGHT_CATEGORY_COLORS.VFR,
  'MVFR', CONFIG.FLIGHT_CATEGORY_COLORS.MVFR,
  'IFR', CONFIG.FLIGHT_CATEGORY_COLORS.IFR,
  'LIFR', CONFIG.FLIGHT_CATEGORY_COLORS.LIFR,
  CONFIG.FLIGHT_CATEGORY_COLORS.unknown,
];
const tfrColor = () => [
  'match', ['get', 'tfrType'],
  'VIP', CONFIG.TFR_COLORS.VIP,
  'SECURITY', CONFIG.TFR_COLORS.SECURITY,
  'SPECIAL', CONFIG.TFR_COLORS.SPECIAL,
  'HAZARDS', CONFIG.TFR_COLORS.HAZARDS,
  CONFIG.TFR_COLORS.default,
];
const airspaceColor = () => [
  'match', ['get', 'styleKey'],
  'B', CONFIG.AIRSPACE_COLORS.B,
  'C', CONFIG.AIRSPACE_COLORS.C,
  'D', CONFIG.AIRSPACE_COLORS.D,
  CONFIG.AIRSPACE_COLORS.sua,
];

function setupAviationLayers() {
  map.addSource('airspace', { type: 'geojson', data: airspaceFC });
  map.addLayer({
    id: 'airspace-fill',
    type: 'fill',
    source: 'airspace',
    layout: { visibility: 'none' },
    paint: {
      'fill-color': airspaceColor(),
      'fill-opacity': ['match', ['get', 'styleKey'], 'sua', 0.08, 'B', 0.05, 0.035],
    },
  }, 'major-roads-halo');
  // Class D outlines are dashed, like the sectional chart; MapLibre cannot
  // vary line-dasharray per feature, so they get their own layer.
  for (const [id, filter, dash] of [
    ['airspace-outline', ['!=', ['get', 'styleKey'], 'D'], null],
    ['airspace-outline-dashed', ['==', ['get', 'styleKey'], 'D'], [3, 2]],
  ]) {
    map.addLayer({
      id,
      type: 'line',
      source: 'airspace',
      filter,
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: {
        'line-color': airspaceColor(),
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          5, ['match', ['get', 'styleKey'], 'B', 1.4, 'C', 1.2, 0.9],
          11, ['match', ['get', 'styleKey'], 'B', 3, 'C', 2.5, 1.8],
        ],
        'line-opacity': 0.85,
        ...(dash ? { 'line-dasharray': dash } : {}),
      },
    }, 'major-roads-halo');
  }
  map.addLayer({
    id: 'airspace-labels',
    type: 'symbol',
    source: 'airspace',
    minzoom: 8,
    layout: {
      visibility: 'none',
      'symbol-placement': 'line',
      'symbol-spacing': 350,
      'text-field': ['get', 'label'],
      'text-size': 10,
      'text-max-angle': 30,
    },
    paint: {
      'text-color': airspaceColor(),
      'text-halo-color': '#10151b',
      'text-halo-width': 1.5,
    },
  }, 'major-roads-halo');

  map.addSource('tfrs', { type: 'geojson', data: tfrFC });
  map.addLayer({
    id: 'tfr-fill',
    type: 'fill',
    source: 'tfrs',
    layout: { visibility: 'none' },
    paint: { 'fill-color': tfrColor(), 'fill-opacity': 0.22 },
  }, 'major-roads-halo');
  map.addLayer({
    id: 'tfr-outline',
    type: 'line',
    source: 'tfrs',
    layout: { visibility: 'none', 'line-join': 'round' },
    paint: {
      'line-color': tfrColor(),
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 12, 3],
      'line-opacity': 0.95,
    },
  }, 'major-roads-halo');

  map.addSource('airport-weather', { type: 'geojson', data: airportWeatherFC });
  map.addLayer({
    id: 'airport-weather-dots',
    type: 'circle',
    source: 'airport-weather',
    layout: { visibility: 'none' },
    paint: {
      'circle-color': flightCategoryColor(),
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.5, 9, 5.5, 13, 8],
      'circle-stroke-color': '#10151b',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.95,
    },
  }, 'veh-bike-dots');
  map.addLayer({
    id: 'airport-weather-labels',
    type: 'symbol',
    source: 'airport-weather',
    minzoom: 8,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'station'],
      'text-size': 10,
      'text-anchor': 'bottom',
      'text-offset': [0, -0.8],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': flightCategoryColor(),
      'text-halo-color': '#10151b',
      'text-halo-width': 1.5,
    },
  }, 'veh-bike-dots');
}

// `label` prefixes the age, e.g. vessels read "Last heard 2 h 5 min ago".
function relativeAge(iso, label = '') {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return 'update time unavailable';
  const age = `${ageText(Date.now() - timestamp)} ago`;
  return label ? `${label} ${age}` : age;
}

// API strings (stop names, vessel names, alert text) are third-party content —
// always escape before interpolating into HTML.
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function wirePopups() {
  for (const fleetId of FLEETS) {
    for (const layerId of [`veh-${fleetId}-dots`, `veh-${fleetId}-icons`]) {
      wirePopupLayer(layerId, fleetId);
    }
  }
  wireRoutePopups();
  for (const layerId of STOP_POINT_LAYERS) wireInformationPopup(layerId);
  wireRoadworkPopups();
  wireInformationPopup('incident-points');
  wireInformationPopup('local-service-points');
  wireInformationPopup('bikeshare-points');
  wireInformationPopup('airport-public-points');
  wireInformationPopup('airport-private-points');
  wireInformationPopup('airport-public-marks');
  wireInformationPopup('airport-private-marks');
  wireInformationPopup('border-crossing-points');
  wireInformationPopup('major-roads-lines');
  wireInformationPopup('freight-rail-lines');
  wireInformationPopup('heritage-rail-lines');
  wireInformationPopup('park-ride-points');
  wireInformationPopup('ev-charging-points');
  wireInformationPopup('drawbridge-points');
  wireInformationPopup('taxi-points');
  wireCameraPopups();
  wireRoadDetailPopups('road-weather-points');
  wireRoadDetailPopups('message-sign-points');
  wireInformationPopup('plow-points');
  wireInformationPopup('plow-route-lines');
  wireInformationPopup('aerialway-lines');
  wireConditionPopups();
}

function wireConditionPopups() {
  map.on('click', 'weather-alert-fill', (event) => {
    // Overlapping zones: list every alert under the click, worst first.
    const seen = new Set();
    const features = event.features.filter((feature) => {
      const id = feature.properties.id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const html = features.map((feature) => {
      const p = feature.properties;
      const timing = [readableTime(p.onset), readableTime(p.ends)].filter(Boolean).join(' – ');
      return `
        <div class="popup-title" style="color:${esc(p.color)}">${esc(p.event)}</div>
        <div class="popup-dest">${esc(p.severity)} · ${esc(p.urgency)}</div>
        ${p.headline ? `<div class="popup-status">${esc(p.headline)}</div>` : ''}
        ${p.description ? `<div class="popup-status popup-details">${esc(p.description)}</div>` : ''}
        ${timing ? `<div class="popup-meta">${esc(timing)}</div>` : ''}
        ${p.areaDesc ? `<div class="popup-meta">${esc(p.areaDesc)}</div>` : ''}
        <div class="popup-meta"><span class="popup-data-status live">live</span> · ${esc(p.senderName || p.provider)} · ${relativeAge(p.updatedAt)}</div>
        ${/^https:\/\//.test(p.sourceUrl ?? '') ? `<a class="popup-route-link" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">Open NWS alert ↗</a>` : ''}`;
    }).join('<hr class="popup-divider">');
    new maplibregl.Popup({ offset: 10, maxWidth: '330px' })
      .setLngLat(event.lngLat)
      .setHTML(html)
      .addTo(map);
  });
  map.on('mouseenter', 'weather-alert-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'weather-alert-fill', () => { map.getCanvas().style.cursor = ''; });
  wireInformationPopup('airport-status-rings');
  wireAviationPopups();
}

// ---- aviation popups -------------------------------------------------------
// METAR dots fetch the station's TAF and TFR polygons their FAA detail text on
// click, through the gateway, with a short in-page cache per station/NOTAM.

const gatewayDetailCache = new Map();
function gatewayDetail(path, ttlMs) {
  const hit = gatewayDetailCache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
  const promise = fetch(`${CONFIG.GATEWAY_BASE}${path}`, { signal: AbortSignal.timeout(10_000) })
    .then((response) => {
      if (!response.ok) throw new Error(`${path} ${response.status}`);
      return response.json();
    });
  gatewayDetailCache.set(path, { at: Date.now(), promise });
  promise.catch(() => gatewayDetailCache.delete(path));
  return promise;
}

const FLIGHT_CATEGORY_TEXT = {
  VFR: 'VFR · visual flight rules',
  MVFR: 'MVFR · marginal VFR',
  IFR: 'IFR · instrument flight rules',
  LIFR: 'LIFR · low IFR',
};
const TFR_TYPE_TEXT = {
  VIP: 'VIP movement',
  SECURITY: 'Security',
  SPECIAL: 'Special security instructions',
  HAZARDS: 'Hazards',
  'UAS PUBLIC GATHERING': 'Drone (UAS) public gathering',
  'AIR SHOWS/SPORTS': 'Air show / sporting event',
  'SPACE OPERATIONS': 'Space operations',
};
const httpsLink = (url, text) => (/^https:\/\//.test(url ?? '')
  ? `<a class="popup-route-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(text)} ↗</a>`
  : '');
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
// Same wording as every other popup ("12 min ago", "2 h 17 min ago"), then a
// date for anything older than a day.
function aviationAge(iso) {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return 'time unavailable';
  const ms = Math.max(0, Date.now() - timestamp);
  if (ms < 24 * 60 * 60_000) return `${ageText(ms)} ago`;
  return readableTime(iso);
}

// A point marker (vehicle, stop, airport, METAR) under the click wins over the
// big polygons around it.
function pointFeatureAt(point, ownLayers) {
  return map.queryRenderedFeatures(point).some((feature) =>
    feature.geometry?.type === 'Point' && feature.properties?.group && !ownLayers.includes(feature.layer.id));
}

function metarPopupHtml(p, tafHtml) {
  const color = CONFIG.FLIGHT_CATEGORY_COLORS[p.flightCategory] ?? CONFIG.FLIGHT_CATEGORY_COLORS.unknown;
  const ceiling = finite(p.ceilingFt)
    ? `Ceiling ${p.ceilingFt.toLocaleString()} ft`
    : ['CLR', 'SKC', 'FEW', 'SCT'].includes(p.cover) ? 'No ceiling' : '';
  const temperature = finite(p.tempC)
    ? `${Math.round(p.tempC)} °C${finite(p.dewpointC) ? ` / dew point ${Math.round(p.dewpointC)} °C` : ''}`
    : '';
  const facts = [
    p.wind && `Wind ${p.wind}`,
    p.visibility && `Visibility ${p.visibility}`,
    ceiling,
    p.weather,
    temperature,
  ].filter(Boolean).join(' · ');
  return `
    <div class="popup-title" style="color:${esc(color)}">${esc(p.title)}</div>
    <div class="popup-dest">${esc(FLIGHT_CATEGORY_TEXT[p.flightCategory] ?? 'Flight category not reported')}</div>
    ${facts ? `<div class="popup-status">${esc(facts)}</div>` : ''}
    ${p.raw ? `<div class="popup-subhead">METAR · observed ${aviationAge(p.observedAt)}</div><div class="popup-raw">${esc(p.raw)}</div>` : ''}
    ${tafHtml}
    <div class="popup-meta"><span class="popup-data-status live">live</span> · ${esc(p.provider || 'NOAA Aviation Weather Center')} · ${aviationAge(p.observedAt)}</div>
    ${httpsLink(p.sourceUrl, 'Open AviationWeather.gov')}`;
}

function tafHtml(taf) {
  if (!taf) return '<div class="popup-route-note">TAF unavailable right now.</div>';
  if (!taf.available) return '<div class="popup-route-note">No TAF is issued for this station.</div>';
  // One forecast period per line, as pilots read it.
  const raw = String(taf.raw).replace(/\s+(?=(?:FM\d{6}|TEMPO|BECMG|PROB\d{2})\b)/g, '\n');
  return `<div class="popup-subhead">TAF · issued ${aviationAge(taf.issuedAt)}</div><div class="popup-raw">${esc(raw)}</div>`;
}

function tfrPopupHtml(p, detail) {
  const color = CONFIG.TFR_COLORS[p.tfrType] ?? CONFIG.TFR_COLORS.default;
  let detailHtml = '';
  if (detail === undefined) {
    detailHtml = '<div class="popup-route-note">Loading altitudes and times…</div>';
  } else if (!detail?.available) {
    detailHtml = '<div class="popup-route-note">Altitudes and times unavailable; open the FAA notice.</div>';
  } else {
    const times = detail.effective?.length
      ? detail.effective
      : [detail.begins && `Begins ${detail.begins}`, detail.ends && `Ends ${detail.ends}`].filter(Boolean);
    detailHtml = [
      ...(detail.altitudes ?? []).map((altitude) => `<div class="popup-status">${esc(altitude)}</div>`),
      times.length ? `<div class="popup-meta">${times.map(esc).join('<br>')}</div>` : '',
      detail.reason ? `<div class="popup-meta">${esc(detail.reason)}</div>` : '',
      detail.notamText ? `<div class="popup-status popup-details">${esc(detail.notamText)}</div>` : '',
    ].join('');
  }
  return `
    <div class="popup-title" style="color:${esc(color)}">TFR ${esc(p.notamId)}${p.facility ? ` · ${esc(p.facility)}` : ''}</div>
    <div class="popup-dest">${esc(TFR_TYPE_TEXT[p.tfrType] ?? p.tfrType ?? 'Temporary flight restriction')}</div>
    <div class="popup-status">${esc(p.title)}</div>
    ${detailHtml}
    <div class="popup-meta"><span class="popup-data-status live">live</span> · ${esc(p.provider || 'FAA Temporary Flight Restrictions')}${p.updatedAt ? ` · NOTAM updated ${aviationAge(p.updatedAt)}` : ''}</div>
    ${httpsLink(p.sourceUrl, 'Open FAA TFR notice')}`;
}

function airspacePopupHtml(features) {
  const items = features.slice(0, 6).map((feature) => {
    const p = feature.properties;
    const color = CONFIG.AIRSPACE_COLORS[p.styleKey] ?? CONFIG.AIRSPACE_COLORS.sua;
    const ceiling = `${p.ceiling}${p.ceilingInclusive === false ? ' (not included)' : ''}`;
    const extra = [p.timesOfUse && `Hours: ${p.timesOfUse}`, p.controllingAgency].filter(Boolean).join(' · ');
    return `
      <div class="popup-title" style="color:${esc(color)}">${esc(p.title)}</div>
      <div class="popup-dest">${esc(p.status)}</div>
      <div class="popup-status">Floor ${esc(p.floor)} · Ceiling ${esc(ceiling)}</div>
      ${extra ? `<div class="popup-meta">${esc(extra)}</div>` : ''}`;
  }).join('<hr class="popup-divider">');
  const more = features.length > 6 ? `<div class="popup-meta">+${features.length - 6} more layers here</div>` : '';
  return `${items}${more}
    <div class="popup-route-note">reference · check current charts and NOTAMs before flying</div>
    <div class="popup-meta"><span class="popup-data-status reference">reference</span> · FAA ADDS airspace, 28-day cycle</div>
    ${httpsLink(features[0]?.properties.sourceUrl, 'Open FAA airspace data')}`;
}

function wireAviationPopups() {
  map.on('click', 'airport-weather-dots', (event) => {
    const feature = event.features[0];
    const p = feature.properties;
    const canFetch = Boolean(CONFIG.GATEWAY_BASE && p.station);
    const popup = new maplibregl.Popup({ offset: 10, maxWidth: '360px' })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(metarPopupHtml(p, canFetch ? '<div class="popup-route-note">Loading TAF…</div>' : ''))
      .addTo(map);
    if (!canFetch) return;
    gatewayDetail(`/api/airport-taf?id=${encodeURIComponent(p.station)}`, 10 * 60_000)
      .then((taf) => { if (popup.isOpen()) popup.setHTML(metarPopupHtml(p, tafHtml(taf))); })
      .catch(() => { if (popup.isOpen()) popup.setHTML(metarPopupHtml(p, tafHtml(null))); });
  });

  map.on('click', 'tfr-fill', (event) => {
    if (pointFeatureAt(event.point, ['tfr-fill', 'tfr-outline'])) return;
    const seen = new Set();
    const tfrs = event.features.filter((feature) => {
      const id = feature.properties.notamId;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, 3);
    const details = new Map();
    const render = () => tfrs
      .map((feature) => tfrPopupHtml(feature.properties, details.get(feature.properties.notamId)))
      .join('<hr class="popup-divider">');
    const popup = new maplibregl.Popup({ offset: 10, maxWidth: '340px' })
      .setLngLat(event.lngLat)
      .setHTML(render())
      .addTo(map);
    for (const feature of tfrs) {
      const id = feature.properties.notamId;
      if (!CONFIG.GATEWAY_BASE) {
        details.set(id, null);
        continue;
      }
      gatewayDetail(`/api/tfr-detail?id=${encodeURIComponent(id)}`, 30 * 60_000)
        .then((detail) => details.set(id, detail))
        .catch(() => details.set(id, null))
        .finally(() => { if (popup.isOpen()) popup.setHTML(render()); });
    }
    if (!CONFIG.GATEWAY_BASE) popup.setHTML(render());
  });

  map.on('click', 'airspace-fill', (event) => {
    if (pointFeatureAt(event.point, ['airspace-fill', 'airspace-labels'])) return;
    if (map.queryRenderedFeatures(event.point, { layers: ['tfr-fill'] }).length) return;
    // MapLibre drops string feature ids, so dedupe on the id property; a
    // polygon that spans tiles comes back once per tile.
    const seen = new Set();
    const features = event.features
      .filter((feature) => {
        const key = feature.properties.airspaceId ?? feature.properties.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (a.properties.floorFt ?? 0) - (b.properties.floorFt ?? 0));
    new maplibregl.Popup({ offset: 10, maxWidth: '330px' })
      .setLngLat(event.lngLat)
      .setHTML(airspacePopupHtml(features))
      .addTo(map);
  });

  for (const layerId of ['airport-weather-dots', 'tfr-fill', 'airspace-fill']) {
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
  }
}

function vehiclePopupHtml(properties) {
  const dataStatus = properties.dataStatus ?? 'live';
  const provider = properties.provider || '';
  const sourceUrl = /^https:\/\//.test(properties.sourceUrl ?? '') ? properties.sourceUrl : '';
  return `
    <div class="popup-title" style="color:${esc(properties.color)}">${esc(properties.title)}</div>
    ${properties.dest ? `<div class="popup-dest">${esc(properties.dest)}</div>` : ''}
    ${properties.status ? `<div class="popup-status">${esc(properties.status)}</div>` : ''}
    ${properties.meta ? `<div class="popup-meta">${esc(properties.meta)}</div>` : ''}
    <div class="popup-meta"><span class="popup-data-status ${esc(dataStatus)}">${esc(dataStatus)}</span>${provider ? ` · ${esc(provider)}` : ''} · ${esc(relativeAge(properties.updatedAt, properties.ageLabel))}</div>
    ${sourceUrl ? `<a class="popup-route-link" href="${esc(sourceUrl)}" target="_blank" rel="noopener">Open source ↗</a>` : ''}`;
}

function informationPopupHtml(properties, extra = '') {
  const sourceUrl = /^https:\/\//.test(properties.sourceUrl ?? '') ? properties.sourceUrl : '';
  const dataStatus = properties.dataStatus ?? 'reference';
  const color = properties.color || '#d2d7dd';
  return `
    <div class="popup-title" style="color:${esc(color)}">${esc(properties.title || 'Map feature')}</div>
    ${properties.status ? `<div class="popup-dest">${esc(properties.status)}</div>` : ''}
    ${properties.details ? `<div class="popup-status">${esc(properties.details)}</div>` : ''}
    ${extra}
    <div class="popup-meta"><span class="popup-data-status ${esc(dataStatus)}">${esc(dataStatus)}</span>${properties.provider ? ` · ${esc(properties.provider)}` : ''}${properties.updatedAt ? ` · ${relativeAge(properties.updatedAt)}` : ''}</div>
    ${sourceUrl ? `<a class="popup-route-link" href="${esc(sourceUrl)}" target="_blank" rel="noopener">Open official source ↗</a>` : ''}`;
}

// Stop/station/landing popups: reference info first, then live MBTA arrivals
// (or a one-line "schedule only" note) appended by predictions.js.
export function openStopPopup(feature) {
  const properties = feature.properties;
  const popup = new maplibregl.Popup({ offset: 10, maxWidth: '330px' })
    .setLngLat(feature.geometry.coordinates)
    .setHTML(informationPopupHtml(properties))
    .addTo(map);
  attachStopPredictions(popup, properties, (extra) => {
    if (popup.isOpen()) popup.setHTML(informationPopupHtml(properties, extra));
  });
  return popup;
}

// Reference-point popup without the stop-predictions block (search uses it
// for airports).
export function openInfoPopup(feature) {
  return new maplibregl.Popup({ offset: 10, maxWidth: '330px' })
    .setLngLat(feature.geometry.coordinates)
    .setHTML(informationPopupHtml(feature.properties))
    .addTo(map);
}

function wireInformationPopup(layerId) {
  map.on('click', layerId, (event) => {
    const feature = event.features[0];
    if (STOP_POINT_LAYERS.includes(layerId) && feature.geometry.type === 'Point') {
      openStopPopup(feature);
      return;
    }
    const coordinates = feature.geometry.type === 'Point'
      ? feature.geometry.coordinates
      : event.lngLat;
    new maplibregl.Popup({ offset: 10, maxWidth: '330px' })
      .setLngLat(coordinates)
      .setHTML(informationPopupHtml(feature.properties))
      .addTo(map);
  });
  map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
}

function wireCameraPopups() {
  map.on('click', 'camera-points', (event) => {
    const feature = event.features[0];
    const p = feature.properties;
    const directImage = /^https:\/\//.test(p.imageUrl ?? '')
      ? `<img class="popup-camera-image" src="${esc(p.imageUrl)}" alt="Latest view from ${esc(p.title || 'this camera')}">`
      : '';
    const popup = new maplibregl.Popup({ offset: 12, maxWidth: '360px' })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(informationPopupHtml(p, directImage || (p.providerKey ? '<div class="popup-route-note">Loading current image…</div>' : '')))
      .addTo(map);
    if (directImage || !p.providerKey || !p.cameraId || !CONFIG.GATEWAY_BASE) return;
    const query = new URLSearchParams({ provider: p.providerKey, id: p.cameraId });
    fetch(`${CONFIG.GATEWAY_BASE}/api/camera-detail?${query}`, {
      signal: AbortSignal.timeout(10_000),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`camera detail ${response.status}`);
        return response.json();
      })
      .then((detail) => {
        if (!popup.isOpen()) return;
        const merged = {
          ...p,
          title: detail.title || p.title,
          status: detail.direction || p.status,
          provider: detail.provider || p.provider,
          sourceUrl: detail.sourceUrl || p.sourceUrl,
          updatedAt: detail.updatedAt || p.updatedAt,
        };
        const image = /^https:\/\//.test(detail.imageUrl ?? '')
          ? `<img class="popup-camera-image" src="${esc(detail.imageUrl)}" alt="Latest view from ${esc(merged.title)}">`
          : '<div class="popup-route-note">Image unavailable; open the official viewer.</div>';
        popup.setHTML(informationPopupHtml(merged, image));
      })
      .catch(() => {
        if (popup.isOpen()) {
          popup.setHTML(informationPopupHtml(p, '<div class="popup-route-note">Current image unavailable; open the official viewer.</div>'));
        }
      });
  });
  map.on('mouseenter', 'camera-points', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'camera-points', () => { map.getCanvas().style.cursor = ''; });
}

function wireRoadDetailPopups(layerId) {
  map.on('click', layerId, (event) => {
    const feature = event.features[0];
    const p = feature.properties;
    const popup = new maplibregl.Popup({ offset: 12, maxWidth: '330px' })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(informationPopupHtml(p, p.providerKey ? '<div class="popup-route-note">Loading the latest report…</div>' : ''))
      .addTo(map);
    if (!p.providerKey || !p.itemId || !p.catalog || !CONFIG.GATEWAY_BASE) return;
    const query = new URLSearchParams({ catalog: p.catalog, provider: p.providerKey, id: p.itemId });
    fetch(`${CONFIG.GATEWAY_BASE}/api/road-detail?${query}`, {
      signal: AbortSignal.timeout(10_000),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`road detail ${response.status}`);
        return response.json();
      })
      .then((detail) => {
        if (!popup.isOpen()) return;
        popup.setHTML(informationPopupHtml({
          ...p,
          title: detail.title || p.title,
          status: detail.status || p.status,
          details: detail.details || p.details,
          provider: detail.provider || p.provider,
          sourceUrl: detail.sourceUrl || p.sourceUrl,
          updatedAt: detail.updatedAt || p.updatedAt,
        }));
      })
      .catch(() => {
        if (popup.isOpen()) {
          popup.setHTML(informationPopupHtml(p, '<div class="popup-route-note">Latest report unavailable.</div>'));
        }
      });
  });
  map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
}

// Only bike-share docks still open this popup: every other vehicle click is
// taken by follow mode, whose trip card shows a plane's scheduled route.
function wirePopupLayer(layerId, fleetId) {
  map.on('click', layerId, (e) => {
      const feature = e.features[0];
      const p = feature.properties;
      if (p.id && vehicleClickHandler?.(fleetId, p.id, p)) return;
      new maplibregl.Popup({ offset: 14, maxWidth: '310px' })
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(vehiclePopupHtml(p))
        .addTo(map);
    });
    map.on('mouseenter', layerId, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
    });
}

export function setRouteShapes(featureCollection) {
  allRouteShapesFC = featureCollection;
  renderRouteShapes();
}

export function scheduledRouteCountsForRegion() {
  const routesByGroup = new Map();
  for (const feature of routeShapesFC.features) {
    const group = feature.properties.group;
    const route = feature.properties.route;
    if (!group || !route) continue;
    if (!routesByGroup.has(group)) routesByGroup.set(group, new Set());
    routesByGroup.get(group).add(route);
  }
  return Object.fromEntries(
    [...routesByGroup.entries()].map(([group, routes]) => [group, routes.size]),
  );
}

export function scheduledStationCountsForRegion() {
  const stationsByGroup = new Map();
  for (const feature of routeShapesFC.features) {
    if (feature.properties.kind !== 'regional-station') continue;
    const group = feature.properties.group;
    if (!group) continue;
    if (!stationsByGroup.has(group)) stationsByGroup.set(group, new Set());
    const [longitude, latitude] = feature.geometry.coordinates;
    stationsByGroup.get(group).add(
      `${feature.properties.title}|${longitude.toFixed(4)},${latitude.toFixed(4)}`,
    );
  }
  return Object.fromEntries(
    [...stationsByGroup.entries()].map(([group, stations]) => [group, stations.size]),
  );
}

function wireRoutePopups() {
  map.on('click', 'route-lines', (event) => {
    if (map.queryRenderedFeatures(event.point, { layers: STOP_POINT_LAYERS }).length) return;
    const properties = event.features[0].properties;
    if (properties.kind !== 'regional-static') return;
    const dataStatus = properties.dataStatus ?? 'scheduled';
    const sourceUrl = /^https:\/\//.test(properties.sourceUrl ?? '')
      ? properties.sourceUrl
      : '';
    const serviceDetails = [properties.serviceType, properties.season].filter(Boolean);
    const html = `
      <div class="popup-title" style="color:${esc(properties.color)}">${esc(properties.name)}</div>
      <div class="popup-dest">${esc(properties.agency)}</div>
      ${serviceDetails.length ? `<div class="popup-meta">${serviceDetails.map(esc).join(' · ')}</div>` : ''}
      <div class="popup-status">${esc(properties.scheduleNote ?? 'Scheduled route · visible even without live vehicle positions')}</div>
      ${properties.geometryNote ? `<div class="popup-meta">${esc(properties.geometryNote)}</div>` : ''}
      <div class="popup-meta"><span class="popup-data-status ${esc(dataStatus)}">${esc(dataStatus)}</span> · ${esc(properties.provider ?? 'Official carrier information')}</div>
      ${sourceUrl ? `<a class="popup-route-link" href="${esc(sourceUrl)}" target="_blank" rel="noopener">View official source ↗</a>` : ''}`;
    new maplibregl.Popup({ offset: 10, maxWidth: '310px' })
      .setLngLat(event.lngLat)
      .setHTML(html)
      .addTo(map);
  });
  map.on('mouseenter', 'route-lines', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'route-lines', () => { map.getCanvas().style.cursor = ''; });
}

function readableTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ''
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function roadworkPopupHtml(p) {
  const sourceLink = /^https:\/\//.test(p.sourceUrl ?? '')
    ? `<a class="popup-route-link" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">Open official source ↗</a>`
    : '';
  if (p.kind === 'construction-project') {
    return `
      <div class="popup-title" style="color:${esc(p.color)}">${esc(p.title)}</div>
      <div class="popup-dest">Construction project</div>
      ${p.details ? `<div class="popup-status popup-details">${esc(p.details)}</div>` : ''}
      <div class="popup-meta"><span class="popup-data-status reference">reference</span> · ${esc(p.provider ?? 'CTDOT construction projects')}</div>
      ${sourceLink}`;
  }
  if (p.kind === 'lane-closure') {
    return `
      <div class="popup-title" style="color:${esc(p.color)}">${esc(p.title)}</div>
      <div class="popup-dest">Lane closure</div>
      ${p.details ? `<div class="popup-status popup-details">${esc(p.details)}</div>` : ''}
      <div class="popup-meta"><span class="popup-data-status live">live</span> · ${esc(p.provider ?? 'CTroads lane closures')} · ${relativeAge(p.updatedAt)}</div>
      ${sourceLink}`;
  }
  const timing = [readableTime(p.startAt), readableTime(p.endAt)].filter(Boolean).join(' – ');
  return `
    <div class="popup-title" style="color:${esc(p.color)}">${esc(p.title)}</div>
    <div class="popup-dest">${p.active ? 'Active work zone' : 'Upcoming work zone'}</div>
    ${p.status ? `<div class="popup-status">${esc(p.status)}</div>` : ''}
    ${p.details ? `<div class="popup-status popup-details">${esc(p.details)}</div>` : ''}
    ${p.workTypes ? `<div class="popup-meta">Work: ${esc(p.workTypes)}</div>` : ''}
    ${timing ? `<div class="popup-meta">${esc(timing)}</div>` : ''}
    <div class="popup-meta"><span class="popup-data-status live">live</span> · ${esc(p.provider ?? 'Official WZDx')} · ${relativeAge(p.updatedAt)}</div>
    ${sourceLink}`;
}

function wireRoadworkPopups() {
  for (const layerId of ['roadwork-lines', 'roadwork-areas', 'roadwork-points']) {
    map.on('click', layerId, (event) => {
      const p = event.features[0].properties;
      new maplibregl.Popup({ offset: 10, maxWidth: '310px' })
        .setLngLat(event.lngLat)
        .setHTML(roadworkPopupHtml(p))
        .addTo(map);
    });
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
  }
}

function renderRouteShapes() {
  routeShapesFC = {
    type: 'FeatureCollection',
    features: allRouteShapesFC.features.filter((feature) => {
      if (activeRegion === 'new-england') return true;
      if (['regional-static', 'regional-station'].includes(feature.properties.kind)) {
        return feature.properties.regions?.includes(activeRegion);
      }
      // MBTA shapes are fetched live, so they carry no build-time region
      // tags: keep a route when any of its vertices is inside the region.
      return featureTouchesRegion(feature, activeRegion);
    }),
  };
  colorRouteFeatures(routeShapesFC.features);
  map?.getSource('route-shapes')?.setData(routeShapesFC);
  applyRoutePalette();
}

/** Publish the region's operator index, then stamp opColor/routeColor from the resulting palette. */
function colorRouteFeatures(features) {
  const index = buildRouteKeyIndex(features);
  setRouteKeyIndex(index);
  stampRouteColors(features, paletteAssignment.peek(), index);
}

export function setRoadworkData(featureCollection) {
  allRoadworkFC = featureCollection;
  renderRoadwork();
}

export function roadworkCountForRegion() {
  return filterSpatialFeatureCollection(allRoadworkFC, activeRegion).features.length;
}

function renderRoadwork() {
  roadworkFC = filterSpatialFeatureCollection(allRoadworkFC, activeRegion);
  map?.getSource('roadwork')?.setData(roadworkFC);
}

export function setRoadEventsData(featureCollection) {
  allRoadEventsFC = featureCollection;
  renderRoadEvents();
}

export function roadEventCountForRegion() {
  return filterSpatialFeatureCollection(allRoadEventsFC, activeRegion).features.length;
}

function renderRoadEvents() {
  roadEventsFC = filterSpatialFeatureCollection(allRoadEventsFC, activeRegion);
  map?.getSource('road-events')?.setData(roadEventsFC);
}

export function setCameraData(featureCollection) {
  allCamerasFC = featureCollection;
  renderCameras();
}

export function cameraCountForRegion() {
  return filterSpatialFeatureCollection(allCamerasFC, activeRegion).features.length;
}

function renderCameras() {
  camerasFC = filterSpatialFeatureCollection(allCamerasFC, activeRegion);
  map?.getSource('cameras')?.setData(camerasFC);
}

export function setRoadWeatherData(featureCollection) {
  allRoadWeatherFC = featureCollection?.features ? featureCollection : EMPTY_FC;
  renderRoadWeather();
}

export function roadWeatherCountForRegion() {
  return filterSpatialFeatureCollection(allRoadWeatherFC, activeRegion).features.length;
}

function renderRoadWeather() {
  roadWeatherFC = filterSpatialFeatureCollection(allRoadWeatherFC, activeRegion);
  map?.getSource('road-weather')?.setData(roadWeatherFC);
}

export function setMessageSignData(featureCollection) {
  allMessageSignsFC = featureCollection?.features ? featureCollection : EMPTY_FC;
  renderMessageSigns();
}

export function messageSignCountForRegion() {
  return filterSpatialFeatureCollection(allMessageSignsFC, activeRegion).features.length;
}

function renderMessageSigns() {
  messageSignsFC = filterSpatialFeatureCollection(allMessageSignsFC, activeRegion);
  map?.getSource('message-signs')?.setData(messageSignsFC);
}

export function setPlowData(featureCollection) {
  allPlowsFC = featureCollection?.features ? featureCollection : EMPTY_FC;
  renderPlows();
}

export function plowCountForRegion() {
  return filterSpatialFeatureCollection(allPlowsFC, activeRegion).features.length;
}

function renderPlows() {
  plowsFC = filterSpatialFeatureCollection(allPlowsFC, activeRegion);
  map?.getSource('plows')?.setData(plowsFC);
}

function renderPlowRoutes() {
  plowRoutesFC = filterSpatialFeatureCollection(allPlowRoutesFC, activeRegion);
  map?.getSource('plow-routes')?.setData(plowRoutesFC);
}

async function ensurePlowRoutes() {
  if (plowRoutesPromise) return plowRoutesPromise;
  plowRoutesPromise = fetch(CONFIG.PLOW_ROUTES_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`plow routes ${response.status}`);
      return response.json();
    })
    .then((collection) => {
      allPlowRoutesFC = collection?.features ? collection : EMPTY_FC;
      renderPlowRoutes();
      notifyReferenceData();
    })
    .catch((error) => {
      plowRoutesPromise = null;
      console.warn('NHDOT plow routes unavailable:', error);
    });
  return plowRoutesPromise;
}

function renderAerialways() {
  aerialwaysFC = filterSpatialFeatureCollection(allAerialwaysFC, activeRegion);
  map?.getSource('aerialways')?.setData(aerialwaysFC);
}

async function ensureAerialways() {
  if (aerialwaysPromise) return aerialwaysPromise;
  aerialwaysPromise = fetch(CONFIG.AERIALWAYS_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`aerialways ${response.status}`);
      return response.json();
    })
    .then((collection) => {
      allAerialwaysFC = collection?.features ? collection : EMPTY_FC;
      renderAerialways();
      notifyReferenceData();
    })
    .catch((error) => {
      aerialwaysPromise = null;
      console.warn('Aerialway reference unavailable:', error);
    });
  return aerialwaysPromise;
}

// ---- conditions data -------------------------------------------------------

export function setWeatherAlertsData(featureCollection) {
  allWeatherFC = featureCollection?.features ? featureCollection : EMPTY_FC;
  renderWeatherAlerts();
}

export function weatherAlertCountForRegion() {
  return filterSpatialFeatureCollection(allWeatherFC, activeRegion).features.length;
}

function renderWeatherAlerts() {
  weatherFC = filterSpatialFeatureCollection(allWeatherFC, activeRegion);
  map?.getSource('weather-alerts')?.setData(weatherFC);
}

// Vertex-average centroid: good enough to fly the map to a zone polygon.
function geometryCentroid(geometry) {
  let x = 0;
  let y = 0;
  let n = 0;
  const visit = (value) => {
    if (!Array.isArray(value) || !value.length) return;
    if (typeof value[0] === 'number') {
      x += value[0];
      y += value[1];
      n += 1;
    } else {
      for (const child of value) visit(child);
    }
  };
  visit(geometry?.coordinates ?? []);
  return n ? [x / n, y / n] : null;
}

const WEATHER_SEVERITY_SCORE = { Extreme: 9, Severe: 7, Moderate: 5, Minor: 3 };

// Extreme/Severe NWS alerts in the selected region, shaped like MBTA alerts so
// the panel and focusAlert() treat them the same way.
export function weatherPanelAlertsForRegion() {
  return weatherFC.features
    .filter((feature) => CONFIG.WEATHER_PANEL_SEVERITIES.includes(feature.properties.severity))
    .map((feature) => {
      const p = feature.properties;
      const centroid = geometryCentroid(feature.geometry);
      return {
        id: `nws-${p.id}`,
        effect: p.event,
        badge: 'NWS',
        severity: WEATHER_SEVERITY_SCORE[p.severity] ?? 5,
        header: p.headline || p.event,
        description: p.description,
        routes: [],
        stops: [],
        focus: { points: centroid ? [centroid] : [] },
      };
    });
}

export function setAirportStatusData(payload) {
  airportStatusPayload = payload?.airports ? payload : { airports: [] };
  renderAirportStatus();
}

export function airportStatusCountForRegion() {
  return filterFeatureCollection(allAirportStatusFC, activeRegion).features.length;
}

const AIRPORT_STATUS_BADGES = {
  'ground-stop': 'STOP',
  'ground-delay': 'GDP',
  'arrival-delay': 'ARR',
  'departure-delay': 'DEP',
  closure: 'CLSD',
};
const AIRPORT_STATUS_RANK = ['ground-stop', 'closure', 'ground-delay', 'arrival-delay', 'departure-delay'];

// Joins FAA status rows to the FAA NASR airport catalog by LID (= IATA for
// these airports). One feature per airport carries its worst condition on
// top and lists the rest in the popup.
function renderAirportStatus() {
  const byIata = new Map();
  for (const status of airportStatusPayload.airports ?? []) {
    if (!byIata.has(status.iata)) byIata.set(status.iata, []);
    byIata.get(status.iata).push(status);
  }
  const features = [];
  for (const airport of allAirportsFC.features ?? []) {
    const statuses = byIata.get(airport.properties?.faaId);
    if (!statuses || airport.geometry?.type !== 'Point') continue;
    statuses.sort((a, b) => AIRPORT_STATUS_RANK.indexOf(a.type) - AIRPORT_STATUS_RANK.indexOf(b.type));
    const worst = statuses[0];
    const lines = statuses.map((status) => [
      AIRPORT_STATUS_LABELS[status.type] ?? status.type,
      status.reason,
      status.avgDelay ? `avg ${status.avgDelay}` : '',
      status.trend ? `trend ${status.trend.toLowerCase()}` : '',
      status.endTime ? `until ${status.endTime}` : '',
    ].filter(Boolean).join(' · '));
    features.push({
      type: 'Feature',
      id: airport.properties.faaId,
      geometry: airport.geometry,
      properties: {
        group: 'airport-status',
        dataStatus: 'live',
        color: CONFIG.AIRPORT_STATUS_COLORS[worst.type] ?? CONFIG.ROADWORK_COLOR,
        badge: AIRPORT_STATUS_BADGES[worst.type] ?? '!',
        iata: worst.iata,
        statusType: worst.type,
        title: `${worst.iata} · ${airport.properties.title}`,
        status: `${AIRPORT_STATUS_LABELS[worst.type] ?? worst.type}${worst.reason ? ` — ${worst.reason}` : ''}`,
        details: lines.join('; '),
        provider: airportStatusPayload.provider ?? 'FAA National Airspace System status',
        sourceUrl: airportStatusPayload.sourceUrl ?? 'https://nasstatus.faa.gov/',
        updatedAt: airportStatusPayload.updatedAt,
      },
    });
  }
  allAirportStatusFC = { type: 'FeatureCollection', features };
  airportStatusFC = filterFeatureCollection(allAirportStatusFC, activeRegion);
  map?.getSource('airport-status')?.setData(airportStatusFC);
}

// ---- aviation conditions data ----------------------------------------------
// METARs and TFRs arrive New England-wide from the gateway; airspace is a
// static FAA reference file fetched the first time its layer is switched on.

export function setAirportWeatherData(featureCollection) {
  allAirportWeatherFC = featureCollection?.features ? featureCollection : EMPTY_FC;
  renderAirportWeather();
}

export function airportWeatherCountForRegion() {
  return filterFeatureCollection(allAirportWeatherFC, activeRegion).features.length;
}

function renderAirportWeather() {
  airportWeatherFC = filterFeatureCollection(allAirportWeatherFC, activeRegion);
  map?.getSource('airport-weather')?.setData(airportWeatherFC);
}

export function setTfrData(featureCollection) {
  allTfrFC = featureCollection?.features ? featureCollection : EMPTY_FC;
  renderTfrs();
}

// One count per NOTAM, however many areas it draws.
export function tfrCountForRegion() {
  const features = filterSpatialFeatureCollection(allTfrFC, activeRegion).features;
  return new Set(features.map((feature) => feature.properties?.notamId)).size;
}

function renderTfrs() {
  tfrFC = filterSpatialFeatureCollection(allTfrFC, activeRegion);
  map?.getSource('tfrs')?.setData(tfrFC);
}

// The file is already New England-scoped; offshore warning areas have no
// vertex on land, so the whole-region view keeps everything.
function renderAirspace() {
  airspaceFC = activeRegion === 'new-england'
    ? allAirspaceFC
    : filterSpatialFeatureCollection(allAirspaceFC, activeRegion);
  map?.getSource('airspace')?.setData(airspaceFC);
}

// Chart-style outline label: class and ceiling/floor in hundreds of feet
// ("B 70/20", "D 26/SFC"), or the special-use area's own name ("R-4101A").
function airspaceLabel(properties) {
  if (properties.kind !== 'class') return properties.title;
  const hundreds = (feet) => (Number.isFinite(feet) ? String(Math.round(feet / 100)) : '');
  const floor = properties.floorFt === 0 ? 'SFC' : hundreds(properties.floorFt);
  return `${properties.airspaceClass} ${hundreds(properties.ceilingFt)}/${floor}`;
}

async function ensureAirspace() {
  if (airspacePromise) return airspacePromise;
  airspacePromise = fetch(CONFIG.AIRSPACE_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`airspace ${response.status}`);
      return response.json();
    })
    .then((collection) => {
      allAirspaceFC = {
        ...collection,
        features: (collection.features ?? []).map((feature) => ({
          ...feature,
          properties: { ...feature.properties, label: airspaceLabel(feature.properties ?? {}) },
        })),
      };
      renderAirspace();
      notifyReferenceData();
    })
    .catch((error) => {
      airspacePromise = null; // let the next switch-on retry
      console.warn('FAA airspace reference unavailable:', error);
    });
  return airspacePromise;
}

function renderAviationConditions() {
  renderAirportWeather();
  renderTfrs();
  renderAirspace();
}

function aviationFocusCoordinates(groupKey) {
  return [airportWeatherFC, tfrFC, airspaceFC]
    .flatMap((collection) => collection.features)
    .filter((feature) => feature.properties?.group === groupKey)
    .flatMap((feature) => (feature.geometry.type === 'Point'
      ? [feature.geometry.coordinates]
      : polygonCoordinates(feature)));
}

// METAR dots and TFRs are live; charted airspace is reference.
function applyAviationVisibility(groups, statuses) {
  for (const [layerId, group, status] of [
    ['airport-weather-dots', 'airport-weather', 'live'],
    ['airport-weather-labels', 'airport-weather', 'live'],
    ['tfr-fill', 'tfr', 'live'],
    ['tfr-outline', 'tfr', 'live'],
    ['airspace-fill', 'airspace', 'reference'],
    ['airspace-outline', 'airspace', 'reference'],
    ['airspace-outline-dashed', 'airspace', 'reference'],
    ['airspace-labels', 'airspace', 'reference'],
  ]) {
    if (!map.getLayer(layerId)) continue;
    map.setLayoutProperty(
      layerId,
      'visibility',
      groups.includes(group) && statuses.includes(status) ? 'visible' : 'none',
    );
  }
}

function renderReferenceData() {
  infrastructureFC = filterSpatialFeatureCollection(allInfrastructureFC, activeRegion);
  localServicesFC = filterSpatialFeatureCollection(allLocalServicesFC, activeRegion);
  bikeshareFC = filterSpatialFeatureCollection(allBikeshareFC, activeRegion);
  airportsFC = filterSpatialFeatureCollection(allAirportsFC, activeRegion);
  borderCrossingsFC = {
    ...allBorderCrossingsFC,
    features: activeRegion === 'new-england'
      ? (allBorderCrossingsFC.features ?? [])
      : (allBorderCrossingsFC.features ?? []).filter((feature) => crossingInRegion(feature, activeRegion)),
  };
  map?.getSource('infrastructure')?.setData(infrastructureFC);
  map?.getSource('local-services')?.setData(localServicesFC);
  map?.getSource('bikeshare-systems')?.setData(bikeshareFC);
  map?.getSource('airports')?.setData(airportsFC);
  map?.getSource('border-crossings')?.setData(borderCrossingsFC);
  renderReferencePlaces();
  renderAirportStatus(); // FAA status may have arrived before the airport catalog
}

// Border crossings sit exactly on the state line, so a plain point-in-polygon
// test is a coin flip. Keep the build-time state tag, and for every other
// region accept a crossing within about 1 km of the boundary.
const CROSSING_NUDGE_DEG = 0.01;
function crossingInRegion(feature, region) {
  if (feature.properties?.regions?.includes(region)) return true;
  const [lng, lat] = feature.geometry?.coordinates ?? [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
    containsPoint(region, [lng + dx * CROSSING_NUDGE_DEG, lat + dy * CROSSING_NUDGE_DEG]));
}

function renderReferencePlaces() {
  referencePlacesFC = filterSpatialFeatureCollection(allReferencePlacesFC, activeRegion);
  map?.getSource('reference-places')?.setData(referencePlacesFC);
}

async function ensureReferencePlaces() {
  if (referencePlacesPromise) return referencePlacesPromise;
  referencePlacesPromise = fetch(CONFIG.REFERENCE_PLACES_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`reference places ${response.status}`);
      return response.json();
    })
    .then((collection) => {
      allReferencePlacesFC = collection;
      renderReferencePlaces();
      notifyReferenceData();
    })
    .catch((error) => {
      console.warn('Reference-places catalog unavailable:', error);
    });
  return referencePlacesPromise;
}

async function ensureReferenceData() {
  if (referenceLoadPromise) return referenceLoadPromise;
  referenceLoadPromise = Promise.allSettled([
    fetch(CONFIG.INFRASTRUCTURE_URL).then((response) => {
      if (!response.ok) throw new Error(`infrastructure ${response.status}`);
      return response.json();
    }),
    fetch(CONFIG.LOCAL_SERVICES_URL).then((response) => {
      if (!response.ok) throw new Error(`local services ${response.status}`);
      return response.json();
    }),
    fetch(CONFIG.BIKESHARE_SYSTEMS_URL).then((response) => {
      if (!response.ok) throw new Error(`bike-share systems ${response.status}`);
      return response.json();
    }),
    fetch(CONFIG.AIRPORTS_URL).then((response) => {
      if (!response.ok) throw new Error(`airports ${response.status}`);
      return response.json();
    }),
    fetch(CONFIG.BORDER_CROSSINGS_URL).then((response) => {
      if (!response.ok) throw new Error(`border crossings ${response.status}`);
      return response.json();
    }),
  ]).then(([infrastructure, local, bikeshare, airports, borders]) => {
    if (infrastructure.status === 'fulfilled') allInfrastructureFC = infrastructure.value;
    else console.warn('Reference road/rail data unavailable:', infrastructure.reason);
    if (local.status === 'fulfilled') allLocalServicesFC = local.value;
    else console.warn('Local-service catalog unavailable:', local.reason);
    if (bikeshare.status === 'fulfilled') allBikeshareFC = bikeshare.value;
    else console.warn('Bike-share system catalog unavailable:', bikeshare.reason);
    if (airports.status === 'fulfilled') allAirportsFC = airports.value;
    else console.warn('FAA airport catalog unavailable:', airports.reason);
    if (borders.status === 'fulfilled') allBorderCrossingsFC = borders.value;
    else console.warn('CBSA border-crossing catalog unavailable:', borders.reason);
    renderReferenceData();
    notifyReferenceData();
  });
  return referenceLoadPromise;
}

// The full FAA landing-facility catalog (every region), for sidebar search.
export const airportFeatures = () => allAirportsFC.features ?? [];

export async function loadReferenceData() {
  await ensureReferenceData();
  return referenceCountsForRegion();
}

export function referenceCountsForRegion() {
  const counts = {};
  for (const collection of [infrastructureFC, localServicesFC, bikeshareFC, airportsFC, borderCrossingsFC, referencePlacesFC]) {
    for (const feature of collection.features ?? []) {
      const group = feature.properties?.group;
      if (group) counts[group] = (counts[group] ?? 0) + 1;
    }
  }
  if (airspaceFC.features.length) counts.airspace = airspaceFC.features.length;
  if (plowRoutesFC.features.length) counts.plow = plowRoutesFC.features.length;
  if (aerialwaysFC.features.length) counts.aerialway = aerialwaysFC.features.length;
  return counts;
}

const rawFleetData = new Map(); // unfiltered provider output
const fleetData = new Map(); // visible FeatureCollections, for focusGroup

export function setFleetData(fleetId, featureCollection) {
  rawFleetData.set(fleetId, featureCollection);
  renderFleetData(fleetId);
}

// Vessels and aircraft filter against the coastal (marine) region geometry
// so they are not clipped at the shoreline. Other fleets use land.
const fleetFilterOptions = fleetBoundaryOptions;

function renderFleetData(fleetId) {
  const collection = rawFleetData.get(fleetId) ?? EMPTY_FC;
  const filtered = filterFeatureCollection(collection, activeRegion, fleetFilterOptions(fleetId));
  fleetData.set(fleetId, filtered);
  map?.getSource(`veh-${fleetId}`)?.setData(filtered);
  scheduleLiveKeyCounts();
  scheduleViewportRoutes();
}

// ---- legend feeds ------------------------------------------------------------
// renderFleetData runs every animation frame during glides, so the legend's
// live counts and viewport routes are coalesced into one update per 300 ms.

const LEGEND_THROTTLE_MS = 300;
let liveKeyTimer = null;
let viewportTimer = null;

function scheduleLiveKeyCounts() {
  if (liveKeyTimer) return;
  liveKeyTimer = setTimeout(() => {
    liveKeyTimer = null;
    setLiveKeyCounts(countLiveKeys(fleetData.values()));
  }, LEGEND_THROTTLE_MS);
}

function scheduleViewportRoutes() {
  if (viewportTimer || !map) return;
  viewportTimer = setTimeout(() => {
    viewportTimer = null;
    // Zoomed out, collapsed, or no route group on: the legend shows no route list.
    if (!layersReady || map.getZoom() < VIEWPORT_ZOOM || !wantsViewportRoutes()) return;
    const layers = ['route-lines', ...FLEETS.flatMap((id) => [`veh-${id}-icons`, `veh-${id}-dots`])]
      .filter((id) => map.getLayer(id));
    setViewportRoutes(viewportRoutesFromFeatures(map.queryRenderedFeatures({ layers })));
  }, LEGEND_THROTTLE_MS);
}

/**
 * Recount and requery for the legend now. Called by the legend bridge when a
 * route list becomes possible (legend expanded or a route group switched on).
 */
export function refreshLegendFeeds() {
  scheduleLiveKeyCounts();
  scheduleViewportRoutes();
}

function wireLegend() {
  setLegendZoom(map.getZoom());
  map.on('zoomend', () => setLegendZoom(map.getZoom()));
  map.on('moveend', scheduleViewportRoutes);
}

// The UI can emit visibility before the map finishes loading — queue the
// latest request and apply it once layers exist.
let pendingFilters = null;
let layersReady = false;
let activeRegion = DEFAULT_REGION;

export function setVisibleGroups(groups, statuses = ['live', 'estimated', 'scheduled', 'reference']) {
  pendingFilters = { groups, statuses };
  if (groups.some((group) => ['roads', 'freight', 'local', 'bikeshare', 'airport', 'border', 'airport-status'].includes(group))) {
    ensureReferenceData();
  }
  if (groups.some((group) => REFERENCE_PLACE_GROUPS.includes(group))) {
    ensureReferencePlaces();
  }
  if (groups.includes('airspace')) ensureAirspace();
  if (groups.includes('plow')) ensurePlowRoutes();
  if (groups.includes('aerialway')) ensureAerialways();
  if (layersReady) applyGroupFilter(groups, statuses);
}

export function setRegion(regionKey, { fit = true } = {}) {
  activeRegion = regionKey;
  setActiveRegion(regionKey);
  if (layersReady) applyRegion(fit);
}

export function fleetCountsForRegion() {
  const sourceNames = {
    bike: 'shared-mobility',
    vessel: 'ais',
    amtrak: 'amtrak',
    regional: 'regional',
    coaches: 'coaches',
    mnr: 'mnr',
    mbta: 'mbta',
    plane: 'planes',
  };
  return Object.fromEntries(
    [...rawFleetData.entries()].map(([fleetId, collection]) => {
      const counts = {};
      const features = filterFeatureCollection(collection, activeRegion, fleetFilterOptions(fleetId)).features;
      for (const feature of features) {
        const group = feature.properties.group;
        counts[group] = (counts[group] ?? 0) + 1;
      }
      return [sourceNames[fleetId] ?? fleetId, counts];
    }),
  );
}

function applyRegion(fit) {
  map.getSource('region-boundary')?.setData(boundaryForRegion(activeRegion));
  renderRouteShapes();
  renderRoadwork();
  renderRoadEvents();
  renderCameras();
  renderRoadWeather();
  renderMessageSigns();
  renderPlows();
  renderPlowRoutes();
  renderAerialways();
  renderReferenceData();
  renderWeatherAlerts();
  renderAviationConditions();
  for (const fleetId of rawFleetData.keys()) renderFleetData(fleetId);
  scheduleLiveKeyCounts();
  if (!fit) return;
  takeCamera('region');
  const bounds = boundsForRegion(activeRegion);
  if (bounds) {
    map.fitBounds(bounds, {
      padding: fitPadding(),
      maxZoom: maxZoomForRegion(activeRegion),
      duration: 1100,
    });
  }
}

function applyGroupFilter(groups, statuses) {
  scheduleViewportRoutes();
  const visible = ['in', ['get', 'group'], ['literal', groups]];
  const statusVisible = [
    'in',
    ['coalesce', ['get', 'dataStatus'], 'live'],
    ['literal', statuses],
  ];
  const visibleByStatus = ['all', visible, statusVisible];
  const railVisible = ['all', visibleByStatus, ['in', ['get', 'group'], ['literal', RAIL_GROUPS]]];
  const iconVisible = ['all', visibleByStatus, ['in', ['get', 'group'], ['literal', ICON_GROUPS]]];

  // Bus ribbons and conceptual air corridors skip the halo pass.
  map.setFilter('route-halo', [
    'all',
    visibleByStatus,
    ['!', ['in', ['get', 'group'], ['literal', ['bus', 'air-service']]]],
  ]);
  map.setFilter('route-lines', visibleByStatus);
  map.setFilter('scheduled-stations', [
    'all',
    visibleByStatus,
    ['==', ['get', 'kind'], 'regional-station'],
    ['in', ['get', 'group'], ['literal', RAIL_GROUPS]],
  ]);
  for (const layerId of ['scheduled-station-halo', 'scheduled-station-labels', 'scheduled-station-labels-close']) {
    map.setFilter(layerId, [
      'all',
      visibleByStatus,
      ['==', ['get', 'kind'], 'regional-station'],
      ['in', ['get', 'group'], ['literal', RAIL_GROUPS]],
    ]);
  }
  for (const layerId of ['scheduled-ferry-stops', 'scheduled-ferry-stop-labels']) {
    map.setFilter(layerId, [
      'all',
      visibleByStatus,
      ['==', ['get', 'kind'], 'regional-station'],
      ['==', ['get', 'group'], 'ferry'],
    ]);
  }
  for (const layerId of ['scheduled-bus-stops', 'scheduled-bus-stop-labels']) {
    map.setFilter(layerId, [
      'all',
      visibleByStatus,
      ['==', ['get', 'kind'], 'regional-station'],
      ['==', ['get', 'group'], 'bus'],
    ]);
  }
  for (const fleetId of FLEETS) {
    map.setFilter(`veh-${fleetId}-dots`, railVisible);
    map.setFilter(`veh-${fleetId}-arrows`, [
      'all',
      railVisible,
      ['==', ['get', 'hasBearing'], true],
    ]);
    map.setFilter(`veh-${fleetId}-icons`, iconVisible);
  }
  // The traffic layer is raster tiles, not features — toggle its visibility.
  if (map.getLayer('traffic-flow')) {
    map.setLayoutProperty(
      'traffic-flow',
      'visibility',
      groups.includes('traffic') && statuses.includes('live') ? 'visible' : 'none',
    );
  }
  for (const layerId of ['roadwork-halo', 'roadwork-lines', 'roadwork-areas', 'roadwork-area-outline', 'roadwork-points']) {
    map.setLayoutProperty(
      layerId,
      'visibility',
      groups.includes('roadwork') ? 'visible' : 'none',
    );
  }
  const lineWork = ['all', statusVisible, ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]]];
  const areaWork = ['all', statusVisible, ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]]];
  const pointWork = ['all', statusVisible, ['==', ['geometry-type'], 'Point']];
  map.setFilter('roadwork-lines', lineWork);
  map.setFilter('roadwork-halo', lineWork);
  map.setFilter('roadwork-areas', areaWork);
  map.setFilter('roadwork-area-outline', areaWork);
  map.setFilter('roadwork-points', pointWork);
  map.setFilter('incident-points', ['all', ['==', ['get', 'group'], 'incident'], statusVisible]);
  map.setFilter('camera-points', ['all', ['==', ['get', 'group'], 'camera'], statusVisible]);
  map.setFilter('road-weather-points', ['all', ['==', ['get', 'group'], 'road-weather'], statusVisible]);
  map.setFilter('message-sign-points', ['all', ['==', ['get', 'group'], 'message-sign'], statusVisible]);
  map.setFilter('plow-points', ['all', ['==', ['get', 'group'], 'plow'], statusVisible]);
  map.setFilter('local-service-points', ['all', ['==', ['get', 'group'], 'local'], statusVisible]);
  for (const layerId of ['bikeshare-points', 'bikeshare-labels']) {
    map.setFilter(layerId, ['all', ['==', ['get', 'group'], 'bikeshare'], statusVisible]);
  }
  for (const layerId of AIRPORT_LAYERS) {
    map.setLayoutProperty(
      layerId,
      'visibility',
      groups.includes('airport') && statuses.includes('reference') ? 'visible' : 'none',
    );
  }
  for (const layerId of ['border-crossing-points', 'border-crossing-labels']) {
    map.setLayoutProperty(
      layerId,
      'visibility',
      groups.includes('border') && statuses.includes('reference') ? 'visible' : 'none',
    );
  }
  for (const [layerId, group] of [
    ['heritage-rail-lines', 'heritage-rail'],
    ['heritage-rail-labels', 'heritage-rail'],
    ['park-ride-points', 'park-ride'],
    ['ev-charging-heat', 'ev-charging'],
    ['ev-charging-points', 'ev-charging'],
    ['drawbridge-points', 'drawbridge'],
    ['drawbridge-labels', 'drawbridge'],
    ['taxi-points', 'taxi'],
    ['taxi-labels', 'taxi'],
  ]) {
    map.setLayoutProperty(
      layerId,
      'visibility',
      groups.includes(group) && statuses.includes('reference') ? 'visible' : 'none',
    );
  }
  for (const [layerId, group] of [
    ['major-roads-halo', 'roads'],
    ['major-roads-lines', 'roads'],
    ['freight-rail-lines', 'freight'],
  ]) {
    map.setFilter(layerId, ['all', ['==', ['get', 'group'], group], statusVisible]);
    map.setLayoutProperty(
      layerId,
      'visibility',
      groups.includes(group) ? 'visible' : 'none',
    );
  }
  for (const [layerId, group, status] of [
    ['incident-points', 'incident', 'live'],
    ['camera-points', 'camera', 'live'],
    ['road-weather-points', 'road-weather', 'live'],
    ['message-sign-points', 'message-sign', 'live'],
    ['plow-points', 'plow', 'live'],
    ['plow-route-lines', 'plow', 'reference'],
    ['aerialway-lines', 'aerialway', 'reference'],
    ['aerialway-labels', 'aerialway', 'reference'],
    ['local-service-points', 'local', null],
    ['bikeshare-points', 'bikeshare', 'reference'],
    ['bikeshare-labels', 'bikeshare', 'reference'],
    ['walking-routes', 'walking', 'reference'],
    ['cycling-routes', 'cycling', 'reference'],
  ]) {
    if (!map.getLayer(layerId)) continue;
    map.setLayoutProperty(
      layerId,
      'visibility',
      groups.includes(group) && (!status || statuses.includes(status)) ? 'visible' : 'none',
    );
  }
  // Conditions layers are all `live`; they follow the group switch plus the live filter.
  for (const [layerId, group] of [
    ['weather-alert-fill', 'weather'],
    ['weather-alert-outline', 'weather'],
    ['airport-status-halo', 'airport-status'],
    ['airport-status-rings', 'airport-status'],
    ['airport-status-labels', 'airport-status'],
  ]) {
    if (!map.getLayer(layerId)) continue;
    map.setLayoutProperty(
      layerId,
      'visibility',
      groups.includes(group) && statuses.includes('live') ? 'visible' : 'none',
    );
  }
  applyAviationVisibility(groups, statuses);
}

// ---- alert focus -----------------------------------------------------------

export function fitPadding() {
  // On mobile the panel closes. On desktop keep targets clear of it, measured
  // from the panel itself so the camera cannot drift from the stylesheet.
  if (window.innerWidth <= 760) return { top: 60, right: 40, bottom: 60, left: 40 };
  const panel = document.getElementById('panel');
  const left = panel ? panel.offsetLeft + panel.offsetWidth + 24 : 40;
  return { top: 70, right: 70, bottom: 70, left };
}

function dropPing(lngLat) {
  clearTimeout(pingTimer);
  pingMarker?.remove();
  const el = document.createElement('div');
  el.className = 'alert-ping';
  pingMarker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  pingTimer = setTimeout(() => pingMarker?.remove(), 5000);
}

// Fly to what an alert affects: its stops when known, else the extent of the
// affected routes' ribbons.
const lineCoordinates = (feature) => feature.geometry.type === 'MultiLineString'
  ? feature.geometry.coordinates.flat()
  : feature.geometry.coordinates;
// Outer rings only: enough to frame a weather zone.
const polygonCoordinates = (feature) => feature.geometry.type === 'MultiPolygon'
  ? feature.geometry.coordinates.flatMap((polygon) => polygon[0])
  : feature.geometry.coordinates[0];

export function focusAlert(alert) {
  const points = alert.focus?.points ?? [];
  let coords = points;

  if (!coords.length && alert.routes?.length) {
    coords = routeShapesFC.features
      .filter((f) => alert.routes.includes(f.properties.route))
      .flatMap(lineCoordinates);
  }
  if (!coords.length) return false;

  takeCamera('alert');
  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0]),
  );
  map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 14.5, duration: 1400 });
  if (points.length) dropPing(points[0]);
  return true;
}

// Zoom to wherever a layer group's vehicles currently are — the one-click
// answer to "where are the commuter rail trains?" when they're all out in
// the suburbs. Falls back to the group's route ribbons when no vehicle is
// reporting (e.g. ferries between rush hours).
export async function focusGroup(groupKey, routeIds = []) {
  if (['roads', 'freight', 'local', 'bikeshare', 'airport', 'border', 'airport-status'].includes(groupKey)) {
    await ensureReferenceData();
  }
  if (REFERENCE_PLACE_GROUPS.includes(groupKey)) {
    await ensureReferencePlaces();
  }
  if (groupKey === 'airspace') await ensureAirspace();
  if (groupKey === 'plow') await ensurePlowRoutes();
  if (groupKey === 'aerialway') await ensureAerialways();
  let coords = [...fleetData.values()]
    .flatMap((fc) => fc.features)
    .filter((f) => f.properties.group === groupKey)
    .map((f) => f.geometry.coordinates);

  if (!coords.length) {
    coords = routeShapesFC.features
      .filter((f) => ['LineString', 'MultiLineString'].includes(f.geometry.type)
        && f.properties.group === groupKey
        && (f.properties.kind === 'regional-static'
          || !routeIds.length
          || routeIds.includes(f.properties.route)))
      .flatMap(lineCoordinates);
  }
  if (!coords.length) {
    coords = [roadworkFC, roadEventsFC, camerasFC, roadWeatherFC, messageSignsFC, plowsFC, plowRoutesFC, aerialwaysFC, infrastructureFC, localServicesFC, bikeshareFC, airportsFC, borderCrossingsFC, referencePlacesFC, weatherFC, airportStatusFC]
      .flatMap((collection) => collection.features)
      .filter((feature) => feature.properties.group === groupKey)
      .flatMap((feature) => feature.geometry.type === 'Point'
        ? [feature.geometry.coordinates]
        : feature.geometry.type.endsWith('Polygon')
          ? polygonCoordinates(feature)
          : lineCoordinates(feature));
  }
  if (!coords.length) coords = aviationFocusCoordinates(groupKey);
  if (!coords.length) return false;

  takeCamera('group');
  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0]),
  );
  map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 13.5, duration: 1200 });
  return true;
}
