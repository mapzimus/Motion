// Shareable view state in the URL hash. Only deltas from the defaults are
// written, so a fresh visit keeps a clean address and a shared link opens
// exactly where it was: region, map center/zoom, layer groups switched on or
// off relative to that region's defaults, and the data-truth filter.
//
//   #r=ma&c=-71.0589,42.335&z=11.5&on=bus,bike&off=red&s=live,scheduled&f=mbta:1864
//
// `f` is the followed vehicle (fleet id, colon, vehicle id). A shared link
// with `f` opens locked onto that vehicle as soon as its feed reports it.
//
// The `?region=`, `?gateway=`, and `?api_key=` query parameters are left
// untouched; only the fragment is rewritten.

import { isRegionKey } from './regions.js';

const ALL_STATUSES = ['live', 'estimated', 'scheduled', 'reference'];
const DEBOUNCE_MS = 300;
const GROUP_KEY = /^[a-z][a-z0-9-]*$/;
const FLEET_KEY = /^[a-z]+$/;

let hooks = null;
let timer = null;

export function readPermalink() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return {};
  const params = new URLSearchParams(hash);
  const state = {};
  const region = params.get('r');
  if (isRegionKey(region)) state.region = region;
  const center = (params.get('c') ?? '').split(',').map(Number);
  const zoom = Number(params.get('z'));
  if (center.length === 2 && center.every(Number.isFinite)
    && Math.abs(center[0]) <= 180 && Math.abs(center[1]) <= 90) {
    state.center = center;
    if (Number.isFinite(zoom) && zoom >= 0 && zoom <= 24) state.zoom = zoom;
  }
  const groups = (value) => (value ?? '').split(',').filter((key) => GROUP_KEY.test(key));
  const on = groups(params.get('on'));
  const off = groups(params.get('off'));
  if (on.length) state.on = on;
  if (off.length) state.off = off;
  if (params.has('s')) {
    const statuses = (params.get('s') ?? '').split(',').filter((key) => ALL_STATUSES.includes(key));
    state.statuses = statuses;
  }
  const follow = params.get('f') ?? '';
  const colon = follow.indexOf(':');
  if (colon > 0) {
    const fleetId = follow.slice(0, colon);
    const id = follow.slice(colon + 1);
    if (FLEET_KEY.test(fleetId) && id && id.length <= 120) state.follow = { fleetId, id };
  }
  return state;
}

export function buildPermalinkHash() {
  if (!hooks) return '';
  const params = new URLSearchParams();
  const region = hooks.getRegion();
  if (region && region !== 'boston') params.set('r', region);
  const map = hooks.map;
  if (map) {
    const center = map.getCenter();
    params.set('c', `${center.lng.toFixed(4)},${center.lat.toFixed(4)}`);
    params.set('z', map.getZoom().toFixed(2));
  }
  const defaults = new Set(hooks.getDefaultGroups(region));
  const visible = new Set(hooks.getVisibleGroups());
  const on = [...visible].filter((key) => !defaults.has(key));
  const off = [...defaults].filter((key) => !visible.has(key));
  if (on.length) params.set('on', on.join(','));
  if (off.length) params.set('off', off.join(','));
  const statuses = hooks.getVisibleStatuses();
  if (statuses.length !== ALL_STATUSES.length) params.set('s', statuses.join(','));
  const follow = hooks.getFollow?.();
  if (follow) params.set('f', `${follow.fleetId}:${follow.id}`);
  return params.toString();
}

function writeHash() {
  const hash = buildPermalinkHash();
  const url = new URL(window.location.href);
  url.hash = hash;
  if (url.href !== window.location.href) history.replaceState(null, '', url);
}

export function schedulePermalinkUpdate() {
  if (!hooks) return;
  clearTimeout(timer);
  timer = setTimeout(writeHash, DEBOUNCE_MS);
}

// `hooks`: { map, getRegion, getDefaultGroups, getVisibleGroups, getVisibleStatuses, getFollow? }
export function initPermalink(nextHooks) {
  hooks = nextHooks;
  hooks.map?.on('moveend', schedulePermalinkUpdate);
  schedulePermalinkUpdate();
}
