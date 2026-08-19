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
const FLEETS = ['bike', 'vessel', 'amtrak', 'regional', 'mnr', 'mbta', 'plane'];

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
let allRoadEventsFC = EMPTY_FC;
let roadEventsFC = EMPTY_FC;
let allCamerasFC = EMPTY_FC;
let camerasFC = EMPTY_FC;
let allInfrastructureFC = EMPTY_FC;
let infrastructureFC = EMPTY_FC;
let allLocalServicesFC = EMPTY_FC;
let localServicesFC = EMPTY_FC;
let referenceLoadPromise = null;

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
        'Data <a href="https://www.mbta.com/developers/v3-api" target="_blank" rel="noopener">MBTA</a> · <a href="https://www.mta.info/developers" target="_blank" rel="noopener">MTA Metro-North</a> · agency GTFS / <a href="https://mobilitydatabase.org" target="_blank" rel="noopener">Mobility Database</a> · <a href="https://content.amtrak.com/content/gtfs/GTFS.zip" target="_blank" rel="noopener">Amtrak schedule GTFS</a> / <a href="https://amtraker.com" target="_blank" rel="noopener">Amtraker live</a> · <a href="https://api.adsb.lol" target="_blank" rel="noopener">ADSB.lol</a> / <a href="https://adsb.fi" target="_blank" rel="noopener">adsb.fi</a> · MassDOT · GBFS · boundaries U.S. Census Bureau',
    }),
    'bottom-right',
  );
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  return new Promise((resolve) => {
    map.on('load', () => {
      setupLayers();
      wirePopups();
      layersReady = true;
      if (pendingFilters) applyGroupFilter(pendingFilters.groups, pendingFilters.statuses);
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
  map.addLayer({
    id: 'scheduled-stations',
    type: 'circle',
    source: 'route-shapes',
    filter: ['==', ['get', 'kind'], 'regional-station'],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.2, 10, 4.2, 14, 7],
      'circle-stroke-color': '#f4f6f8',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 14, 1.8],
      'circle-opacity': 0.9,
      'circle-stroke-opacity': 0.9,
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
  // Operational point layers remain clickable above route ribbons and dense
  // infrastructure without covering moving vehicle symbols.
  for (const layerId of ['local-service-points', 'camera-points', 'incident-points']) {
    map.moveLayer(layerId, 'veh-bike-dots');
  }
}

function relativeAge(iso) {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return 'update time unavailable';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
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
  wireInformationPopup('scheduled-stations');
  wireRoadworkPopups();
  wireInformationPopup('incident-points');
  wireInformationPopup('local-service-points');
  wireInformationPopup('major-roads-lines');
  wireInformationPopup('freight-rail-lines');
  wireCameraPopups();
}

function vehiclePopupHtml(properties, routeHtml = '') {
  const dataStatus = properties.dataStatus ?? 'live';
  const provider = properties.provider || '';
  const sourceUrl = /^https:\/\//.test(properties.sourceUrl ?? '') ? properties.sourceUrl : '';
  return `
    <div class="popup-title" style="color:${esc(properties.color)}">${esc(properties.title)}</div>
    ${properties.dest ? `<div class="popup-dest">${esc(properties.dest)}</div>` : ''}
    ${routeHtml}
    ${properties.status ? `<div class="popup-status">${esc(properties.status)}</div>` : ''}
    ${properties.meta ? `<div class="popup-meta">${esc(properties.meta)}</div>` : ''}
    <div class="popup-meta"><span class="popup-data-status ${esc(dataStatus)}">${esc(dataStatus)}</span>${provider ? ` · ${esc(provider)}` : ''} · ${relativeAge(properties.updatedAt)}</div>
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

function wireInformationPopup(layerId) {
  map.on('click', layerId, (event) => {
    const feature = event.features[0];
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
    const popup = new maplibregl.Popup({ offset: 12, maxWidth: '360px' })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(informationPopupHtml(p, p.providerKey ? '<div class="popup-route-note">Loading current image…</div>' : ''))
      .addTo(map);
    if (!p.providerKey || !p.cameraId || !CONFIG.GATEWAY_BASE) return;
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

function wireRoutePopups() {
  map.on('click', 'route-lines', (event) => {
    if (map.queryRenderedFeatures(event.point, { layers: ['scheduled-stations'] }).length) return;
    const properties = event.features[0].properties;
    if (properties.kind !== 'regional-static') return;
    const sourceUrl = /^https:\/\//.test(properties.sourceUrl ?? '')
      ? properties.sourceUrl
      : '';
    const html = `
      <div class="popup-title" style="color:${esc(properties.color)}">${esc(properties.name)}</div>
      <div class="popup-dest">${esc(properties.agency)}</div>
      <div class="popup-status">${esc(properties.scheduleNote ?? 'Scheduled route · visible even without live vehicle positions')}</div>
      <div class="popup-meta"><span class="popup-data-status scheduled">scheduled</span> · ${esc(properties.provider ?? 'Published schedule')}</div>
      ${sourceUrl ? `<a class="popup-route-link" href="${esc(sourceUrl)}" target="_blank" rel="noopener">View carrier schedule ↗</a>` : ''}`;
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
      ${p.details ? `<div class="popup-status popup-details">${esc(p.details)}</div>` : ''}
      ${p.workTypes ? `<div class="popup-meta">Work: ${esc(p.workTypes)}</div>` : ''}
      ${timing ? `<div class="popup-meta">${esc(timing)}</div>` : ''}
      <div class="popup-meta"><span class="popup-data-status live">live</span> · ${esc(p.provider ?? 'Official WZDx')} · ${relativeAge(p.updatedAt)}</div>
      ${/^https:\/\//.test(p.sourceUrl ?? '') ? `<a class="popup-route-link" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">Open official feed ↗</a>` : ''}`;
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
      if (['regional-static', 'regional-station'].includes(feature.properties.kind)) {
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

function renderReferenceData() {
  infrastructureFC = filterSpatialFeatureCollection(allInfrastructureFC, activeRegion);
  localServicesFC = filterSpatialFeatureCollection(allLocalServicesFC, activeRegion);
  map?.getSource('infrastructure')?.setData(infrastructureFC);
  map?.getSource('local-services')?.setData(localServicesFC);
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
  ]).then(([infrastructure, local]) => {
    if (infrastructure.status === 'fulfilled') allInfrastructureFC = infrastructure.value;
    else console.warn('Reference road/rail data unavailable:', infrastructure.reason);
    if (local.status === 'fulfilled') allLocalServicesFC = local.value;
    else console.warn('Local-service catalog unavailable:', local.reason);
    renderReferenceData();
  });
  return referenceLoadPromise;
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
let pendingFilters = null;
let layersReady = false;
let activeRegion = 'boston';

export function setVisibleGroups(groups, statuses = ['live', 'estimated', 'scheduled', 'reference']) {
  pendingFilters = { groups, statuses };
  if (groups.some((group) => ['roads', 'freight', 'local'].includes(group))) {
    ensureReferenceData();
  }
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
    mnr: 'mnr',
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
  renderRoadEvents();
  renderCameras();
  renderReferenceData();
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

function applyGroupFilter(groups, statuses) {
  const visible = ['in', ['get', 'group'], ['literal', groups]];
  const statusVisible = [
    'in',
    ['coalesce', ['get', 'dataStatus'], 'live'],
    ['literal', statuses],
  ];
  const visibleByStatus = ['all', visible, statusVisible];
  const railVisible = ['all', visibleByStatus, ['in', ['get', 'group'], ['literal', RAIL_GROUPS]]];
  const iconVisible = ['all', visibleByStatus, ['in', ['get', 'group'], ['literal', ICON_GROUPS]]];

  // Bus ribbons skip the halo pass — 150 glowing routes would wash the map.
  map.setFilter('route-halo', ['all', visibleByStatus, ['!=', ['get', 'group'], 'bus']]);
  map.setFilter('route-lines', visibleByStatus);
  map.setFilter('scheduled-stations', [
    'all',
    visibleByStatus,
    ['==', ['get', 'kind'], 'regional-station'],
  ]);
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
  for (const layerId of ['roadwork-halo', 'roadwork-lines']) {
    map.setLayoutProperty(
      layerId,
      'visibility',
      groups.includes('roadwork') ? 'visible' : 'none',
    );
  }
  map.setFilter('roadwork-lines', statusVisible);
  map.setFilter('roadwork-halo', statusVisible);
  map.setFilter('incident-points', ['all', ['==', ['get', 'group'], 'incident'], statusVisible]);
  map.setFilter('camera-points', ['all', ['==', ['get', 'group'], 'camera'], statusVisible]);
  map.setFilter('local-service-points', ['all', ['==', ['get', 'group'], 'local'], statusVisible]);
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
    ['local-service-points', 'local', null],
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
      .filter((f) => ['LineString', 'MultiLineString'].includes(f.geometry.type)
        && f.properties.group === groupKey
        && (f.properties.kind === 'regional-static'
          || !routeIds.length
          || routeIds.includes(f.properties.route)))
      .flatMap(lineCoordinates);
  }
  if (!coords.length) {
    coords = [roadworkFC, roadEventsFC, camerasFC, infrastructureFC, localServicesFC]
      .flatMap((collection) => collection.features)
      .filter((feature) => feature.properties.group === groupKey)
      .flatMap((feature) => feature.geometry.type === 'Point'
        ? [feature.geometry.coordinates]
        : lineCoordinates(feature));
  }
  if (!coords.length) return false;

  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0]),
  );
  map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 13.5, duration: 1200 });
  return true;
}
