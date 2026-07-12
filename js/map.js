// Map engine: MapLibre GL setup, route ribbons, one animated layer-pair per
// vehicle fleet, source-agnostic popups, and alert-focus navigation.

import { CONFIG } from './config.js';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// Draw order, bottom to top: bike docks under boats under trains under planes.
const FLEETS = ['bike', 'vessel', 'amtrak', 'mbta', 'plane'];

export let map;
let routeShapesFC = EMPTY_FC; // kept for alert-focus bounds math
let pingMarker = null;
let pingTimer = null;

export function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: CONFIG.BASEMAP_STYLE,
    center: CONFIG.MAP_CENTER,
    zoom: CONFIG.MAP_ZOOM,
    minZoom: 7.5,
    maxZoom: 17.5,
    maxBounds: CONFIG.MAP_BOUNDS,
    attributionControl: false,
  });
  window.__map = map; // console/debug access

  map.addControl(
    new maplibregl.AttributionControl({
      compact: true,
      customAttribution:
        'Data <a href="https://www.mbta.com/developers/v3-api" target="_blank" rel="noopener">MBTA</a> · <a href="https://amtraker.com" target="_blank" rel="noopener">Amtraker</a> · <a href="https://airplanes.live" target="_blank" rel="noopener">airplanes.live</a> · <a href="https://aisstream.io" target="_blank" rel="noopener">AISStream</a>',
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

function setupLayers() {
  map.addImage('nav-chevron', chevronImage(), { pixelRatio: 2 });

  // Live congestion raster under everything else we draw — only when a
  // TomTom key is configured (see config.js).
  if (CONFIG.TOMTOM_KEY) {
    map.addSource('traffic-flow', {
      type: 'raster',
      tiles: [CONFIG.TRAFFIC_TILE_TEMPLATE.replace('{key}', CONFIG.TOMTOM_KEY)],
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
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 15, 4.5],
      'line-opacity': 0.9,
    },
  });

  for (const fleetId of FLEETS) {
    map.addSource(`veh-${fleetId}`, { type: 'geojson', data: EMPTY_FC });
    map.addLayer({
      id: `veh-${fleetId}-dots`,
      type: 'circle',
      source: `veh-${fleetId}`,
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
      filter: ['==', ['get', 'hasBearing'], true],
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
    const layerId = `veh-${fleetId}-dots`;
    map.on('click', layerId, (e) => {
      const p = e.features[0].properties;
      const html = `
        <div class="popup-title" style="color:${esc(p.color)}">${esc(p.title)}</div>
        ${p.dest ? `<div class="popup-dest">${esc(p.dest)}</div>` : ''}
        ${p.status ? `<div class="popup-status">${esc(p.status)}</div>` : ''}
        <div class="popup-meta">${p.meta ? `${esc(p.meta)} · ` : ''}${relativeAge(p.updatedAt)}</div>`;
      new maplibregl.Popup({ offset: 14, maxWidth: '280px' })
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(html)
        .addTo(map);
    });
    map.on('mouseenter', layerId, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
    });
  }
}

export function setRouteShapes(featureCollection) {
  routeShapesFC = featureCollection;
  map.getSource('route-shapes')?.setData(featureCollection);
}

const fleetData = new Map(); // fleetId -> latest FeatureCollection, for focusGroup

export function setFleetData(fleetId, featureCollection) {
  fleetData.set(fleetId, featureCollection);
  map.getSource(`veh-${fleetId}`)?.setData(featureCollection);
}

// The UI can emit visibility before the map finishes loading — queue the
// latest request and apply it once layers exist.
let pendingGroups = null;
let layersReady = false;

export function setVisibleGroups(groups) {
  pendingGroups = groups;
  if (layersReady) applyGroupFilter(groups);
}

function applyGroupFilter(groups) {
  const groupFilter = ['in', ['get', 'group'], ['literal', groups]];
  map.setFilter('route-halo', groupFilter);
  map.setFilter('route-lines', groupFilter);
  for (const fleetId of FLEETS) {
    map.setFilter(`veh-${fleetId}-dots`, groupFilter);
    map.setFilter(`veh-${fleetId}-arrows`, [
      'all',
      groupFilter,
      ['==', ['get', 'hasBearing'], true],
    ]);
  }
  // The traffic layer is raster tiles, not features — toggle its visibility.
  if (map.getLayer('traffic-flow')) {
    map.setLayoutProperty(
      'traffic-flow',
      'visibility',
      groups.includes('traffic') ? 'visible' : 'none',
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
export function focusAlert(alert) {
  const points = alert.focus?.points ?? [];
  let coords = points;

  if (!coords.length && alert.routes?.length) {
    coords = routeShapesFC.features
      .filter((f) => alert.routes.includes(f.properties.route))
      .flatMap((f) => f.geometry.coordinates);
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

  if (!coords.length && routeIds.length) {
    coords = routeShapesFC.features
      .filter((f) => routeIds.includes(f.properties.route))
      .flatMap((f) => f.geometry.coordinates);
  }
  if (!coords.length) return false;

  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0]),
  );
  map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 13.5, duration: 1200 });
  return true;
}
