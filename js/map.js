// Map engine: MapLibre GL setup, sources, layers, and popups.
// Vehicles render as two layers over the route ribbons: a color-coded dot
// (circle layer) plus a white heading chevron (symbol layer rotated by GPS bearing).

import { CONFIG } from './config.js';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

export let map;

export function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: CONFIG.BASEMAP_STYLE,
    center: CONFIG.MAP_CENTER,
    zoom: CONFIG.MAP_ZOOM,
    minZoom: 9,
    maxZoom: 17.5,
    maxBounds: CONFIG.MAP_BOUNDS,
    attributionControl: false,
  });

  window.__map = map; // console/debug access

  map.addControl(
    new maplibregl.AttributionControl({
      compact: true,
      customAttribution:
        'Data <a href="https://www.mbta.com/developers/v3-api" target="_blank" rel="noopener">MBTA V3 API</a>',
    }),
    'bottom-right',
  );
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  return new Promise((resolve) => {
    map.on('load', () => {
      setupLayers();
      wirePopups();
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

  map.addSource('route-shapes', { type: 'geojson', data: EMPTY_FC });
  map.addSource('vehicles', { type: 'geojson', data: EMPTY_FC });

  // Soft glow under the route ribbons so lines read on the dark basemap.
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

  map.addLayer({
    id: 'vehicle-dots',
    type: 'circle',
    source: 'vehicles',
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
    id: 'vehicle-arrows',
    type: 'symbol',
    source: 'vehicles',
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
    paint: {
      'icon-opacity': ['case', ['get', 'stale'], 0.3, 0.95],
    },
  });
}

function relativeAge(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
}

// API strings (stop names, alert text) are third-party content — always escape
// before interpolating into HTML.
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function wirePopups() {
  map.on('click', 'vehicle-dots', (e) => {
    const p = e.features[0].properties;
    const html = `
      <div class="popup-route" style="color:${esc(p.color)}">${esc(p.routeName)}</div>
      <div class="popup-dest">to ${esc(p.destination || '—')}</div>
      <div class="popup-status">${esc(p.statusText)}</div>
      <div class="popup-meta">
        ${p.label ? `car ${esc(p.label)} · ` : ''}${relativeAge(p.updatedAt)}${p.occupancy ? ` · ${esc(p.occupancy.toLowerCase())}` : ''}
      </div>`;
    new maplibregl.Popup({ offset: 14, maxWidth: '260px' })
      .setLngLat(e.features[0].geometry.coordinates)
      .setHTML(html)
      .addTo(map);
  });
  map.on('mouseenter', 'vehicle-dots', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'vehicle-dots', () => {
    map.getCanvas().style.cursor = '';
  });
}

export function setRouteShapes(featureCollection) {
  map.getSource('route-shapes')?.setData(featureCollection);
}

export function setVehicleData(featureCollection) {
  map.getSource('vehicles')?.setData(featureCollection);
}

export function setVisibleRoutes(routeIds) {
  const routeFilter = ['in', ['get', 'route'], ['literal', routeIds]];
  map.setFilter('route-halo', routeFilter);
  map.setFilter('route-lines', routeFilter);
  map.setFilter('vehicle-dots', routeFilter);
  map.setFilter('vehicle-arrows', ['all', routeFilter, ['==', ['get', 'hasBearing'], true]]);
}
