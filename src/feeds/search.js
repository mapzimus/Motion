// Sidebar search: stops, stations, landings, route ribbons, the eight
// geographies, and municipalities that appear in stop names. Everything is
// indexed client-side from data already on the page — no geocoder, no
// network. The index is built lazily on first use, after the route snapshot
// has loaded, so startup cost is zero.

import { map, openStopPopup, takeCamera } from '../map/map.js';
import {
  REGIONS,
  containsPoint,
  featureTouchesRegion,
  getActiveRegion,
  smallestRegionAt,
  stateAt,
} from './regions.js';
import { recentVehicles, searchVehicles } from './vehicle-search.js';

const MAX_RESULTS = 8;
const DEBOUNCE_MS = 70;
const TYPE_PRIORITY = { vehicle: 7, region: 6, municipality: 5, station: 4, landing: 3, route: 2, stop: 1 };
const TYPE_LABEL = {
  vehicle: '',
  region: 'Geography',
  municipality: 'Municipality',
  station: 'Station',
  landing: 'Ferry landing',
  route: 'Route',
  stop: 'Stop',
};
const STREET_SUFFIX = new Set([
  'st', 'street', 'ave', 'avenue', 'rd', 'road', 'pike', 'tpke', 'turnpike',
  'hwy', 'highway', 'blvd', 'ln', 'dr', 'way', 'post', 'pl', 'ct', 'sq',
  'square', 'pkwy', 'rte', 'route', 'line', 'ferry', 'mall', 'hill',
]);

// Cities and towns worth jumping to, grouped by state because several names
// exist in more than one (Salem MA/NH, Concord, Plymouth, Manchester, ...). A
// municipality is only indexed when at least one stop name mentions it, so this
// list never invents a place.
const MUNICIPALITIES = {
  ma: [
    'Boston', 'Cambridge', 'Somerville', 'Brookline', 'Newton', 'Quincy',
    'Braintree', 'Chelsea', 'Everett', 'Revere', 'Malden', 'Medford', 'Arlington',
    'Belmont', 'Watertown', 'Milton', 'Winthrop', 'Lynn', 'Salem', 'Beverly',
    'Gloucester', 'Peabody', 'Waltham', 'Lexington', 'Woburn', 'Burlington',
    'Lowell', 'Lawrence', 'Haverhill', 'Newburyport', 'Framingham', 'Natick',
    'Wellesley', 'Needham', 'Dedham', 'Norwood', 'Brockton', 'Plymouth', 'Hingham',
    'Hull', 'Weymouth', 'Worcester', 'Fitchburg', 'Leominster', 'Springfield',
    'Holyoke', 'Northampton', 'Amherst', 'Greenfield', 'Pittsfield', 'North Adams',
    'Fall River', 'New Bedford', 'Taunton', 'Attleboro', 'Hyannis', 'Barnstable',
    'Provincetown', 'Falmouth', 'Woods Hole', 'Nantucket', 'Oak Bluffs',
    'Vineyard Haven', 'Edgartown', 'Marlborough', 'Concord', 'Andover', 'Salisbury',
    'Rockport', 'Foxborough',
  ],
  ct: [
    'Hartford', 'New Haven', 'Bridgeport', 'Stamford', 'Norwalk', 'Danbury',
    'Waterbury', 'New Britain', 'Meriden', 'Middletown', 'New London', 'Norwich',
    'Groton', 'Mystic', 'Old Saybrook', 'Westport', 'Fairfield', 'Milford',
    'Greenwich', 'Manchester', 'Bristol', 'Torrington', 'Storrs', 'Windsor',
    'Wallingford', 'Berlin', 'Enfield',
  ],
  ri: [
    'Providence', 'Warwick', 'Cranston', 'Pawtucket', 'Newport', 'Woonsocket',
    'Westerly', 'Kingston', 'Bristol', 'Jamestown', 'Block Island', 'Narragansett',
  ],
  nh: [
    'Manchester', 'Nashua', 'Concord', 'Portsmouth', 'Dover', 'Durham', 'Exeter',
    'Keene', 'Laconia', 'Lebanon', 'Hanover', 'Littleton', 'Berlin', 'Plymouth',
    'Rochester', 'Salem', 'Claremont', 'Conway',
  ],
  vt: [
    'Burlington', 'Montpelier', 'Rutland', 'Brattleboro', 'Bennington',
    'St. Albans', 'St. Johnsbury', 'Barre', 'Middlebury', 'Essex Junction',
    'Waterbury', 'White River Junction', 'Stowe', 'Newport', 'Windsor',
  ],
  me: [
    'Portland', 'Bangor', 'Lewiston', 'Auburn', 'Augusta', 'Brunswick', 'Saco',
    'Biddeford', 'Bar Harbor', 'Rockland', 'Camden', 'Belfast', 'Ellsworth',
    'Waterville', 'Presque Isle', 'Caribou', 'Orono', 'Freeport', 'Kennebunk',
    'Wells', 'Sanford', 'Boothbay Harbor', 'Vinalhaven', 'Lincolnville',
  ],
};
const STATE_ABBR = { ma: 'MA', ct: 'CT', ri: 'RI', nh: 'NH', vt: 'VT', me: 'ME' };

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

let pendingFeatures = null;
let pendingRouteInfo = new Map();
let entries = null; // built lazily
let el = {};
let activeIndex = -1;
let results = [];
let debounceTimer = null;
let onRegionSelect = () => {};
let onVehicleSelect = () => {};

// Called whenever the route snapshot (regional + MBTA ribbons) is published.
export function setSearchFeatures(features, routeInfo = new Map()) {
  pendingFeatures = features;
  pendingRouteInfo = routeInfo;
  entries = null; // rebuild on next keystroke
}

function distanceKm([lng1, lat1], [lng2, lat2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function boundsOf(coordinates) {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of coordinates) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return [[west, south], [east, north]];
}

function buildIndex() {
  const list = [];
  for (const region of REGIONS) {
    list.push({ type: 'region', name: region.name, norm: normalize(region.name), key: region.key, sub: 'Switch geography' });
  }

  const muniByNorm = new Map(); // normalized name -> [{ name, state }]
  for (const [state, names] of Object.entries(MUNICIPALITIES)) {
    for (const name of names) {
      const key = normalize(name);
      if (!muniByNorm.has(key)) muniByNorm.set(key, []);
      muniByNorm.get(key).push({ name, state });
    }
  }
  const muniHits = new Map(); // "name|state" -> { name, state, ambiguous, points }
  const stopByKey = new Map(); // dedupe key -> entry (station wins over stop)
  const routeGeometry = new Map(); // route id -> { name, sub, color, features }

  for (const feature of pendingFeatures ?? []) {
    const p = feature.properties ?? {};
    if (p.kind === 'regional-station' && feature.geometry?.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates;
      const dedupe = `${p.title}|${lng.toFixed(4)},${lat.toFixed(4)}`;
      const type = p.stopKind === 'landing' ? 'landing' : p.stopKind === 'station' ? 'station' : 'stop';
      const existing = stopByKey.get(dedupe);
      if (existing) {
        // The same place can appear as a bus stop and a rail station; keep
        // the richer record so "Alewife" reads as a station.
        if (TYPE_PRIORITY[type] > TYPE_PRIORITY[existing.type]) {
          Object.assign(existing, { type, sub: p.status || '', feature });
        }
        continue;
      }
      const norm = normalize(p.title);
      const entry = { type, name: p.title, norm, sub: p.status || '', lng, lat, feature };
      stopByKey.set(dedupe, entry);
      list.push(entry);

      const words = norm.split(' ');
      for (let i = 0; i < words.length; i += 1) {
        for (let n = 1; n <= 3 && i + n <= words.length; n += 1) {
          const candidates = muniByNorm.get(words.slice(i, i + n).join(' '));
          if (!candidates) continue;
          if (STREET_SUFFIX.has(words[i + n] ?? '')) continue; // "Boston St"
          // A name shared by several states belongs to whichever state the stop is in.
          const candidate = candidates.length === 1
            ? candidates[0]
            : candidates.find((option) => option.state === stateAt([lng, lat]));
          if (!candidate) continue;
          const hitKey = `${candidate.name}|${candidate.state}`;
          if (!muniHits.has(hitKey)) {
            muniHits.set(hitKey, { ...candidate, ambiguous: candidates.length > 1, points: [] });
          }
          muniHits.get(hitKey).points.push([lng, lat]);
        }
      }
    } else if (p.kind === 'regional-static' && p.route) {
      if (!routeGeometry.has(p.route)) {
        routeGeometry.set(p.route, {
          name: p.name || p.route,
          sub: p.agency || p.provider || '',
          color: p.color || '#8a939c',
          features: [],
        });
      }
      routeGeometry.get(p.route).features.push(feature);
    } else if (p.kind === 'mbta' && p.route) {
      const info = pendingRouteInfo.get(p.route);
      if (!routeGeometry.has(p.route)) {
        const name = info?.type === 3
          ? `Bus ${info.shortName || p.route}`
          : info?.longName || info?.shortName || p.route;
        routeGeometry.set(p.route, {
          name,
          sub: 'MBTA',
          color: p.color || info?.color || '#8a939c',
          features: [],
        });
      }
      routeGeometry.get(p.route).features.push(feature);
    }
  }

  for (const [id, route] of routeGeometry) {
    list.push({ type: 'route', name: route.name, norm: normalize(route.name), sub: route.sub, color: route.color, id, features: route.features });
  }

  for (const { name, state, ambiguous, points } of muniHits.values()) {
    const center = [median(points.map((c) => c[0])), median(points.map((c) => c[1]))];
    const nearby = points.filter((c) => distanceKm(c, center) <= 12);
    list.push({
      type: 'municipality',
      name: ambiguous ? `${name}, ${STATE_ABBR[state]}` : name,
      norm: normalize(name),
      sub: `${nearby.length} stop${nearby.length === 1 ? '' : 's'} mention it`,
      bounds: boundsOf(nearby),
      center,
    });
  }
  entries = list;
}

function score(entry, q, tokens) {
  const { norm } = entry;
  if (norm === q) return 100;
  if (norm.startsWith(q)) return 80;
  if (norm.includes(` ${q}`)) return 60;
  if (tokens.length > 1 && tokens.every((t) => norm.startsWith(t) || norm.includes(` ${t}`))) return 50;
  if (norm.includes(q)) return 40;
  return 0;
}

export function search(query) {
  if (!entries) buildIndex();
  const q = normalize(query);
  if (!q) return recentVehicles().slice(0, MAX_RESULTS);
  // Live vehicles first: a lone digit can be a real train or bus number.
  const scored = searchVehicles(query);
  if (q.length < 2) return scored.map(([, entry]) => entry);
  const tokens = q.split(' ');
  for (const entry of entries) {
    const s = score(entry, q, tokens);
    if (s) scored.push([s, entry]);
  }
  scored.sort((a, b) =>
    b[0] - a[0]
    || TYPE_PRIORITY[b[1].type] - TYPE_PRIORITY[a[1].type]
    || a[1].name.length - b[1].name.length
    || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, MAX_RESULTS).map(([, entry]) => entry);
}

// ---- highlight ribbon -------------------------------------------------------

const HIGHLIGHT_SOURCE = 'search-highlight';

function ensureHighlightLayers() {
  if (!map || map.getSource(HIGHLIGHT_SOURCE)) return;
  map.addSource(HIGHLIGHT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'search-highlight-halo',
    type: 'line',
    source: HIGHLIGHT_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.22, 'line-blur': 4 },
  });
  map.addLayer({
    id: 'search-highlight-line',
    type: 'line',
    source: HIGHLIGHT_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.95 },
  });
}

export function clearHighlight() {
  map?.getSource(HIGHLIGHT_SOURCE)?.setData({ type: 'FeatureCollection', features: [] });
}

function highlightRoute(entry) {
  ensureHighlightLayers();
  map.getSource(HIGHLIGHT_SOURCE).setData({
    type: 'FeatureCollection',
    features: entry.features.map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: { color: entry.color },
    })),
  });
}

function fitPadding() {
  return window.innerWidth > 760
    ? { top: 70, right: 70, bottom: 70, left: 410 }
    : { top: 60, right: 40, bottom: 60, left: 40 };
}

function closePanelOnMobile() {
  if (window.matchMedia('(max-width: 760px)').matches) {
    document.body.classList.remove('panel-open');
    document.getElementById('panel-toggle')?.setAttribute('aria-expanded', 'false');
  }
}

// ---- selection --------------------------------------------------------------

function routeCoordinates(entry) {
  return entry.features.flatMap((feature) =>
    feature.geometry.type === 'MultiLineString'
      ? feature.geometry.coordinates.flat()
      : feature.geometry.coordinates);
}

// The region to switch to so a picked result shows live data, or null when the
// active region already covers it (or the result switches region itself).
export function regionForEntry(entry, activeRegion) {
  let point = null;
  if (entry.type === 'municipality') {
    point = entry.center;
  } else if (entry.type === 'stop' || entry.type === 'station' || entry.type === 'landing') {
    point = [entry.lng, entry.lat];
  } else if (entry.type === 'route') {
    if (entry.features.some((feature) => featureTouchesRegion(feature, activeRegion))) return null;
    const [[west, south], [east, north]] = boundsOf(routeCoordinates(entry));
    point = [(west + east) / 2, (south + north) / 2];
  }
  if (!point || containsPoint(activeRegion, point)) return null;
  return smallestRegionAt(point);
}

export function selectEntry(entry) {
  if (!entry) return;
  clearHighlight();
  if (entry.type === 'vehicle') {
    onVehicleSelect(entry.fleetId, entry.id);
    closePanelOnMobile();
    return;
  }
  if (entry.type !== 'region') {
    takeCamera('search');
    const target = regionForEntry(entry, getActiveRegion());
    if (target) onRegionSelect(target);
  }
  if (entry.type === 'region') {
    onRegionSelect(entry.key);
  } else if (entry.type === 'route') {
    highlightRoute(entry);
    const coordinates = routeCoordinates(entry);
    if (coordinates.length) {
      map.fitBounds(boundsOf(coordinates), { padding: fitPadding(), maxZoom: 13.5, duration: 1200 });
    }
  } else if (entry.type === 'municipality') {
    map.fitBounds(entry.bounds, { padding: fitPadding(), maxZoom: 13, duration: 1200 });
  } else {
    const center = [entry.lng, entry.lat];
    const zoom = Math.max(map.getZoom(), entry.type === 'stop' ? 15 : 13.5);
    const current = map.getCenter();
    const alreadyThere = distanceKm([current.lng, current.lat], center) < 0.05
      && Math.abs(map.getZoom() - zoom) < 0.01;
    if (alreadyThere) {
      openStopPopup(entry.feature);
    } else {
      map.flyTo({ center, zoom, padding: fitPadding(), duration: 1100, essential: true });
      // After flyTo: starting it stops any move in progress (a region switch
      // fits the camera first) and that move's `moveend` must not open the popup.
      map.once('moveend', () => openStopPopup(entry.feature));
    }
  }
  closePanelOnMobile();
}

// ---- combobox UI --------------------------------------------------------------

function renderResults() {
  const list = el.list;
  list.innerHTML = '';
  for (const [index, entry] of results.entries()) {
    const item = document.createElement('li');
    item.id = `search-option-${index}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(index === activeIndex));
    item.className = `search-option${index === activeIndex ? ' active' : ''}`;
    const swatch = document.createElement('span');
    swatch.className = 'search-swatch';
    swatch.style.background = entry.color || 'transparent';
    swatch.hidden = !entry.color;
    const name = document.createElement('span');
    name.className = 'search-name';
    name.textContent = entry.name;
    const sub = document.createElement('span');
    sub.className = 'search-sub';
    sub.textContent = [TYPE_LABEL[entry.type], entry.sub].filter(Boolean).join(' · ');
    item.append(swatch, name, sub);
    if (entry.type === 'vehicle') {
      const live = document.createElement('span');
      live.className = 'search-live';
      live.textContent = entry.stale ? 'old fix' : 'live';
      name.after(live);
    }
    item.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus in the input
    item.addEventListener('click', () => choose(index));
    list.appendChild(item);
  }
  const open = results.length > 0;
  list.hidden = !open;
  el.input.setAttribute('aria-expanded', String(open));
  if (activeIndex >= 0 && open) {
    el.input.setAttribute('aria-activedescendant', `search-option-${activeIndex}`);
  } else {
    el.input.removeAttribute('aria-activedescendant');
  }
  const focused = document.activeElement === el.input;
  el.status.textContent = open
    ? `${results.length} result${results.length === 1 ? '' : 's'}`
    : focused && el.input.value.trim().length >= 1 ? 'No matches' : '';
}

function closeResults() {
  results = [];
  activeIndex = -1;
  renderResults();
}

function choose(index) {
  const entry = results[index] ?? results[0];
  if (!entry) return;
  el.input.value = entry.name;
  closeResults();
  el.status.textContent = '';
  el.input.blur();
  selectEntry(entry);
}

function runSearch() {
  results = search(el.input.value);
  activeIndex = results.length ? 0 : -1;
  renderResults();
}

export function initSearch({ onRegion, onVehicle } = {}) {
  onRegionSelect = onRegion ?? onRegionSelect;
  onVehicleSelect = onVehicle ?? onVehicleSelect;
  el = {
    input: document.getElementById('search-input'),
    list: document.getElementById('search-results'),
    status: document.getElementById('search-status'),
  };
  if (!el.input || !el.list) return;

  el.input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, DEBOUNCE_MS);
  });
  el.input.addEventListener('focus', () => {
    if (!results.length) runSearch(); // empty box shows recently followed vehicles
  });
  el.input.addEventListener('blur', () => setTimeout(closeResults, 120));
  el.input.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown':
        if (!results.length) runSearch();
        if (!results.length) return;
        event.preventDefault();
        activeIndex = (activeIndex + 1) % results.length;
        renderResults();
        break;
      case 'ArrowUp':
        if (!results.length) return;
        event.preventDefault();
        activeIndex = (activeIndex - 1 + results.length) % results.length;
        renderResults();
        break;
      case 'Enter':
        if (!results.length) runSearch();
        if (!results.length) return;
        event.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        if (results.length) closeResults();
        else {
          el.input.value = '';
          clearHighlight();
        }
        break;
      default:
    }
  });
}
