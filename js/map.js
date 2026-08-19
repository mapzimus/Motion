// Map engine: MapLibre GL setup, route ribbons, one animated layer-pair per
// vehicle fleet, source-agnostic popups, and alert-focus navigation.

import { CONFIG } from './config.js';
import { lookupFlightRoute } from './flight-routes.js';
import {
  boundaryForRegion,
  boundsForRegion,
  filterFeatureCollection,
  filterSpatialFeatureCollection,
  setActiveRegion,
} from './regions.js';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// Draw order, bottom to top: bike docks under boats under trains under planes.
const FLEETS = ['bike', 'vessel', 'amtrak', 'regional', 'mbta', 'plane'];

// The visual language: SHAPE says what kind of vehicle it is, COLOR says whose
// service it is. Rail keeps the classic dot + heading chevron; every other
// mode gets its own silhouette so it reads at first glance.
const RAIL_GROUPS = ['red', 'orange', 'green', 'blue', 'silver', 'mattapan', 'commuter', 'amtrak'];
const ICON_GROUPS = ['bus', 'ferry', 'plane', 'vessel', 'bike'];

export let map;
let routeShapesFC = EMPTY_FC; // kept for alert-focus bounds math
let allRouteShapesFC = EMPTY_FC;
let pingMarker = null;
let pingTimer = null;
let trafficAvailable = false;
let allRoadworkFC = EMPTY_FC;
let roadworkFC = EMPTY_FC;

export function configureGateway(capabilities) {
  trafficAvailable = Boolean(capabilities?.traffic);
}

export function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: CONFIG.BASEMAP_STYLE,
    center: CONFIG.MAP_CENTER,
    zoom: CONFIG.MAP_ZOOM,
    minZoom: 5,
    maxZoom: 17.5,
    maxBounds: CONFIG.MAP_BOUNDS,
    attributionControl: false,
  });
  window.__map = map; // console/debug access

  map.addControl(
    new maplibregl.AttributionControl({
      compact: true,
      customAttribution:
        'Data <a href="https://www.mbta.com/developers/v3-api" target="_blank" rel="noopener">MBTA</a> · agency GTFS / <a href="https://mobilitydatabase.org" target="_blank" rel="noopener">Mobility Database</a> · <a href="https://amtraker.com" target="_blank" rel="noopener">Amtraker</a> · <a href="https://api.adsb.lol" target="_blank" rel="noopener">ADSB.lol</a> / <a href="https://adsb.fi" target="_blank" rel="noopener">adsb.fi</a> · MassDOT · GBFS · boundaries U.S. Census Bureau',
    }),
    'bottom-right',
  );
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  return new Promise((resolve) => {
    map.on('load', () => {
      setupLayers();
      wirePopups();
      layersReady = true;
      if (pendingGroups) applyGroupFilter(pendingGroups);
      applyRegion(false);
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

function mirroredPolygon(ctx, rightHalf, size) {
  const u = size / 64;
  ctx.beginPath();
  ctx.moveTo(rightHalf[0][0] * u, rightHalf[0][1] * u);
  for (const [x, y] of rightHalf.slice(1)) ctx.lineTo(x * u, y * u);
  for (const [x, y] of [...rightHalf].reverse()) ctx.lineTo((64 - x) * u, y * u);
  ctx.closePath();
}

// Airliner from above, nose up: fuselage, swept wings, tailplane.
const PLANE_HALF = [
  [32, 2], [35, 8], [36, 20], [62, 36], [62, 43], [36, 33],
  [35, 46], [45, 56], [45, 61], [32, 57],
];
// Boat hull from above, bow up.
const BOAT_HALF = [
  [32, 2], [45, 14], [48, 34], [45, 58], [32, 61],
];

const roundedRect = (x, y, w, h, r) => (ctx, size) => {
  const u = size / 64;
  ctx.beginPath();
  ctx.roundRect(x * u, y * u, w * u, h * u, r * u);
};

const diamond = (ctx, size) => {
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.08);
  ctx.lineTo(size * 0.92, size * 0.5);
  ctx.lineTo(size * 0.5, size * 0.92);
  ctx.lineTo(size * 0.08, size * 0.5);
  ctx.closePath();
};

const scooter = (ctx, size) => {
  const u = size / 64;
  ctx.beginPath();
  ctx.roundRect(12 * u, 40 * u, 38 * u, 11 * u, 5 * u);
  ctx.moveTo(43 * u, 42 * u);
  ctx.lineTo(48 * u, 12 * u);
  ctx.lineTo(57 * u, 12 * u);
  ctx.lineTo(57 * u, 18 * u);
  ctx.lineTo(51 * u, 18 * u);
  ctx.lineTo(47 * u, 42 * u);
};

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

function registerModeIcons() {
  const icons = {
    'icon-plane': makeIcon(CONFIG.PLANE_COLOR, (c, s) => mirroredPolygon(c, PLANE_HALF, s)),
    'icon-boat-ferry': makeIcon(CONFIG.FERRY_COLOR, (c, s) => mirroredPolygon(c, BOAT_HALF, s)),
    'icon-boat-vessel': makeIcon(CONFIG.VESSEL_COLOR, (c, s) => mirroredPolygon(c, BOAT_HALF, s)),
    'icon-bus': makeIcon(CONFIG.BUS_COLOR, roundedRect(21, 8, 22, 48, 9)),
    'icon-dock-ok': makeIcon(CONFIG.BIKE_COLOR, roundedRect(15, 15, 34, 34, 8)),
    'icon-dock-low': makeIcon(CONFIG.BIKE_LOW_COLOR, roundedRect(15, 15, 34, 34, 8)),
    'icon-dock-empty': makeIcon(CONFIG.BIKE_EMPTY_COLOR, roundedRect(15, 15, 34, 34, 8)),
    'icon-share-bike': makeIcon(CONFIG.BIKE_FREE_COLOR, diamond),
    'icon-share-scooter': makeIcon(CONFIG.BIKE_FREE_COLOR, scooter),
  };
  for (const [name, image] of Object.entries(icons)) {
    map.addImage(name, image, { pixelRatio: 2 });
  }
}

function setupLayers() {
  map.addImage('nav-chevron', chevronImage(), { pixelRatio: 2 });
  registerModeIcons();

  // Live congestion raster under everything else we draw — only when a
  // TomTom key is configured (see config.js).
  if (CONFIG.TRAFFIC_TILE_TEMPLATE && trafficAvailable) {
    map.addSource('traffic-flow', {
      type: 'raster',
      tiles: [CONFIG.TRAFFIC_TILE_TEMPLATE],
      tileSize: 256,
      attribution: '© TomTom',
    });
    map.addLayer({
      id: 'traffic-flow',
      type: 'raster',
      source: 'traffic-flow',
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0.7 },
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

  map.addSource('roadwork', { type: 'geojson', data: EMPTY_FC });
  map.addLayer({
    id: 'roadwork-halo',
    type: 'line',
    source: 'roadwork',
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

  map.addSource('route-shapes', { type: 'geojson', data: EMPTY_FC });

  map.addLayer({
    id: 'route-halo',
    type: 'line',
    source: 'route-shapes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
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
      'line-color': ['get', 'color'],
      // The ~150 bus ribbons render thin and faint so they inform without
      // burying the rail network.
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, ['case', ['==', ['get', 'group'], 'bus'], 0.7, 1.8],
        15, ['case', ['==', ['get', 'group'], 'bus'], 2.2, 4.5],
      ],
      'line-opacity': ['case', ['==', ['get', 'group'], 'bus'], 0.45, 0.9],
    },
  });

  for (const fleetId of FLEETS) {
    map.addSource(`veh-${fleetId}`, { type: 'geojson', data: EMPTY_FC });
    map.addLayer({
      id: `veh-${fleetId}-dots`,
      type: 'circle',
      source: `veh-${fleetId}`,
      filter: ['in', ['get', 'group'], ['literal', RAIL_GROUPS]],
      paint: {
        'circle-color': ['get', 'color'],
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
          'match', ['get', 'group'],
          'plane', 'icon-plane',
          'bus', 'icon-bus',
          'ferry', 'icon-boat-ferry',
          'vessel', 'icon-boat-vessel',
          // default arm = shared mobility; shape separates docks from vehicles
          ['match', ['get', 'markerKind'],
            'scooter', 'icon-share-scooter',
            'bicycle', 'icon-share-bike',
            ['match', ['get', 'color'],
              CONFIG.BIKE_LOW_COLOR, 'icon-dock-low',
              CONFIG.BIKE_EMPTY_COLOR, 'icon-dock-empty',
              'icon-dock-ok']],
        ],
        'icon-size': [
          'interpolate', ['linear'], ['zoom'],
          9, ['match', ['get', 'group'], 'plane', 0.38, 'bike', 0.2, 0.3],
          15, ['match', ['get', 'group'], 'plane', 0.8, 'bike', 0.5, 0.7],
        ],
        'icon-rotate': ['case', ['get', 'hasBearing'], ['get', 'bearing'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['case', ['get', 'stale'], 0.35, 1] },
    });
  }
}

function relativeAge(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
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
      wirePopupLayer(layerId);
    }
  }
  wireRoutePopups();
  wireRoadworkPopups();
}

function vehiclePopupHtml(properties, routeHtml = '') {
  return `
    <div class="popup-title" style="color:${esc(properties.color)}">${esc(properties.title)}</div>
    ${properties.dest ? `<div class="popup-dest">${esc(properties.dest)}</div>` : ''}
    ${routeHtml}
    ${properties.status ? `<div class="popup-status">${esc(properties.status)}</div>` : ''}
    <div class="popup-meta">${properties.meta ? `${esc(properties.meta)} · ` : ''}${relativeAge(properties.updatedAt)}</div>`;
}

function scheduledRouteHtml(route) {
  if (!route?.airports?.length) {
    return '<div class="popup-status">Scheduled origin/destination unavailable for this callsign.</div>';
  }
  const codes = route.airports.map((airport) => airport.iata || airport.icao).filter(Boolean);
  const endpoints = [route.airports[0], route.airports.at(-1)];
  return `
    <div class="popup-route">${codes.map(esc).join(' → ')}</div>
    <div class="popup-status">${endpoints.map((airport) => esc(airport.name)).join(' → ')}</div>
    <div class="popup-route-note">Best-effort scheduled route</div>`;
}

function wirePopupLayer(layerId) {
  map.on('click', layerId, (e) => {
      const feature = e.features[0];
      const p = feature.properties;
      const popup = new maplibregl.Popup({ offset: 14, maxWidth: '310px' })
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(vehiclePopupHtml(p))
        .addTo(map);
      if (p.group === 'plane' && p.callsign) {
        popup.setHTML(vehiclePopupHtml(p, '<div class="popup-route-note">Looking up scheduled route…</div>'));
        lookupFlightRoute(p.callsign)
          .then((route) => {
            if (popup.isOpen()) popup.setHTML(vehiclePopupHtml(p, scheduledRouteHtml(route)));
          })
          .catch(() => {
            if (popup.isOpen()) popup.setHTML(vehiclePopupHtml(p, scheduledRouteHtml(null)));
          });
      }
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

function wireRoutePopups() {
  map.on('click', 'route-lines', (event) => {
    const properties = event.features[0].properties;
    if (properties.kind !== 'regional-static') return;
    const html = `
      <div class="popup-title" style="color:${esc(properties.color)}">${esc(properties.name)}</div>
      <div class="popup-dest">${esc(properties.agency)}</div>
      <div class="popup-status">Scheduled route · visible even without live vehicle positions</div>`;
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

function wireRoadworkPopups() {
  map.on('click', 'roadwork-lines', (event) => {
    const p = event.features[0].properties;
    const timing = [readableTime(p.startAt), readableTime(p.endAt)].filter(Boolean).join(' – ');
    const html = `
      <div class="popup-title" style="color:${esc(p.color)}">${esc(p.title)}</div>
      <div class="popup-dest">${p.active ? 'Active work zone' : 'Upcoming work zone'}</div>
      ${p.status ? `<div class="popup-status">${esc(p.status)}</div>` : ''}
      ${timing ? `<div class="popup-meta">${esc(timing)}</div>` : ''}`;
    new maplibregl.Popup({ offset: 10, maxWidth: '310px' })
      .setLngLat(event.lngLat)
      .setHTML(html)
      .addTo(map);
  });
  map.on('mouseenter', 'roadwork-lines', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'roadwork-lines', () => { map.getCanvas().style.cursor = ''; });
}

function renderRouteShapes() {
  routeShapesFC = {
    type: 'FeatureCollection',
    features: allRouteShapesFC.features.filter((feature) => {
      if (activeRegion === 'new-england') return true;
      if (feature.properties.kind === 'regional-static') {
        return feature.properties.regions?.includes(activeRegion);
      }
      return ['boston', 'ma'].includes(activeRegion);
    }),
  };
  map?.getSource('route-shapes')?.setData(routeShapesFC);
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

const rawFleetData = new Map(); // unfiltered provider output
const fleetData = new Map(); // visible FeatureCollections, for focusGroup

export function setFleetData(fleetId, featureCollection) {
  rawFleetData.set(fleetId, featureCollection);
  renderFleetData(fleetId);
}

function renderFleetData(fleetId) {
  const collection = rawFleetData.get(fleetId) ?? EMPTY_FC;
  const filtered = filterFeatureCollection(collection, activeRegion);
  fleetData.set(fleetId, filtered);
  map?.getSource(`veh-${fleetId}`)?.setData(filtered);
}

// The UI can emit visibility before the map finishes loading — queue the
// latest request and apply it once layers exist.
let pendingGroups = null;
let layersReady = false;
let activeRegion = 'boston';

export function setVisibleGroups(groups) {
  pendingGroups = groups;
  if (layersReady) applyGroupFilter(groups);
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
    mbta: 'mbta',
    plane: 'planes',
  };
  return Object.fromEntries(
    [...rawFleetData.entries()].map(([fleetId, collection]) => {
      const counts = {};
      for (const feature of filterFeatureCollection(collection, activeRegion).features) {
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
  for (const fleetId of rawFleetData.keys()) renderFleetData(fleetId);
  if (!fit) return;
  const bounds = boundsForRegion(activeRegion);
  if (bounds) {
    map.fitBounds(bounds, {
      padding: fitPadding(),
      maxZoom: activeRegion === 'boston' ? 11.4 : 8.8,
      duration: 1100,
    });
  }
}

function applyGroupFilter(groups) {
  const visible = ['in', ['get', 'group'], ['literal', groups]];
  const railVisible = ['all', visible, ['in', ['get', 'group'], ['literal', RAIL_GROUPS]]];
  const iconVisible = ['all', visible, ['in', ['get', 'group'], ['literal', ICON_GROUPS]]];

  // Bus ribbons skip the halo pass — 150 glowing routes would wash the map.
  map.setFilter('route-halo', ['all', visible, ['!=', ['get', 'group'], 'bus']]);
  map.setFilter('route-lines', visible);
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
      groups.includes('traffic') ? 'visible' : 'none',
    );
  }
  for (const layerId of ['roadwork-halo', 'roadwork-lines']) {
    map.setLayoutProperty(
      layerId,
      'visibility',
      groups.includes('roadwork') ? 'visible' : 'none',
    );
  }
}

// ---- alert focus -----------------------------------------------------------

function fitPadding() {
  // Keep targets clear of the console on desktop; on mobile the panel closes.
  return window.innerWidth > 760
    ? { top: 70, right: 70, bottom: 70, left: 420 }
    : { top: 60, right: 40, bottom: 60, left: 40 };
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

export function focusAlert(alert) {
  const points = alert.focus?.points ?? [];
  let coords = points;

  if (!coords.length && alert.routes?.length) {
    coords = routeShapesFC.features
      .filter((f) => alert.routes.includes(f.properties.route))
      .flatMap(lineCoordinates);
  }
  if (!coords.length) return false;

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
export function focusGroup(groupKey, routeIds = []) {
  let coords = [...fleetData.values()]
    .flatMap((fc) => fc.features)
    .filter((f) => f.properties.group === groupKey)
    .map((f) => f.geometry.coordinates);

  if (!coords.length) {
    coords = routeShapesFC.features
      .filter((f) => f.properties.group === groupKey
        && (f.properties.kind === 'regional-static'
          || !routeIds.length
          || routeIds.includes(f.properties.route)))
      .flatMap(lineCoordinates);
  }
  if (!coords.length) return false;

  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0]),
  );
  map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 13.5, duration: 1200 });
  return true;
}
