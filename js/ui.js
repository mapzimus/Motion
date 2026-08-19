// Panel UI: layer toggles, alert feed, connection status, loading states.

import { CONFIG } from './config.js';
import { focusAlert, focusGroup } from './map.js';
import { REGIONS } from './regions.js';

const el = (id) => document.getElementById(id);

let GROUPS = [];
const groupState = new Map();
const countsBySource = new Map(); // source -> Map(group key, count)
const manualGroupOverrides = new Set();
const STATE_BUS_DEFAULT_ON = new Set(['ct', 'ri', 'nh', 'vt', 'me']);
const statusState = new Map([
  ['live', true],
  ['estimated', true],
  ['scheduled', true],
  ['reference', true],
]);
let scheduledCounts = new Map();
let onVisibleChange = () => {};
let onRegionChange = () => {};
let status = { state: 'connecting', lastUpdate: null, retryAtMs: null, message: '' };

// Layer groups are built at init because route membership and colors come from
// the API (e.g. "every type-3 route that isn't Silver Line" = the bus group).
function buildGroups(routeInfo, capabilities) {
  const routesOfType = (t) =>
    [...routeInfo.values()].filter((r) => r.type === t).map((r) => r.id);
  const colorOf = (routeId) => routeInfo.get(routeId)?.color;

  return [
    // Subway lines (the master switch governs these). Green's four branches
    // toggle as one because that's how riders think of them. Mattapan is
    // branded Red but is its own light-rail trolley, so it keeps its own row.
    { key: 'red', name: 'Red Line', initial: 'R', section: 'subway', routes: ['Red'], color: colorOf('Red') },
    { key: 'orange', name: 'Orange Line', initial: 'O', section: 'subway', routes: ['Orange'], color: colorOf('Orange') },
    { key: 'green', name: 'Green Line', initial: 'G', section: 'subway', routes: ['Green-B', 'Green-C', 'Green-D', 'Green-E'], color: colorOf('Green-B') },
    { key: 'blue', name: 'Blue Line', initial: 'B', section: 'subway', routes: ['Blue'], color: colorOf('Blue') },
    { key: 'silver', name: 'Silver Line', initial: 'SL', section: 'subway', routes: [...CONFIG.SILVER_ROUTES], color: colorOf('741') },
    { key: 'mattapan', name: 'Mattapan Trolley', initial: 'M', section: 'subway', routes: ['Mattapan'], color: colorOf('Mattapan') },
    // The wider fleet.
    { key: 'commuter', name: 'Commuter & regional rail', initial: 'CR', section: 'ground', sectionName: 'Ground & rail', routes: routesOfType(2), color: CONFIG.COMMUTER_COLOR, truth: 'live + schedule' },
    { key: 'bus', name: 'Local, rural & intercity buses', initial: 'B', section: 'ground', routes: routesOfType(3).filter((id) => !CONFIG.SILVER_ROUTES.includes(id)), color: CONFIG.BUS_COLOR, darkText: true, truth: 'live + schedule' },
    { key: 'amtrak', name: 'Amtrak', initial: 'A', section: 'ground', routes: [], color: CONFIG.AMTRAK_COLOR, truth: 'live + schedule' },
    { key: 'local', name: 'Local & on-demand services', initial: 'L', section: 'ground', routes: [], color: CONFIG.LOCAL_COLOR, darkText: true, truth: 'catalog', countAsVehicle: false },
    { key: 'ferry', name: 'Ferries & passenger boats', initial: 'F', section: 'airwater', sectionName: 'Air & water', routes: routesOfType(4), color: CONFIG.FERRY_COLOR, truth: 'live + schedule' },
    { key: 'plane', name: 'Aircraft', initial: '✈', section: 'airwater', routes: [], color: CONFIG.PLANE_COLOR, truth: 'live', needsKey: !capabilities?.aircraft, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'setup' },
    { key: 'vessel', name: 'Live vessels (AIS)', initial: '⚓', section: 'airwater', routes: [], color: CONFIG.VESSEL_COLOR, truth: 'live', needsKey: !capabilities?.ais, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'AIS key' },
    { key: 'bike', name: 'Public bike & scooter share', initial: 'b', section: 'shared', sectionName: 'Shared & active travel', routes: [], color: CONFIG.BIKE_COLOR, truth: 'live' },
    { key: 'walking', name: 'Marked walking & hiking routes', initial: 'W', section: 'shared', routes: [], color: CONFIG.WALK_COLOR, truth: 'OSM routes', countAsVehicle: false, zoomable: false },
    { key: 'cycling', name: 'Marked cycling routes', initial: 'C', section: 'shared', routes: [], color: CONFIG.CYCLE_COLOR, truth: 'OSM routes', countAsVehicle: false, zoomable: false },
    { key: 'traffic', name: 'Live congestion speeds', initial: '≋', section: 'conditions', sectionName: 'Roads & conditions', routes: [], color: CONFIG.INCIDENT_COLOR, truth: 'live 511', needsKey: !capabilities?.traffic, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false, zoomable: false },
    { key: 'roadwork', name: 'Work zones & closures', initial: '!', section: 'conditions', routes: [], color: CONFIG.ROADWORK_COLOR, truth: 'live WZDx', needsKey: !capabilities?.roadwork, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    { key: 'incident', name: 'Traffic incidents', initial: '!', section: 'conditions', routes: [], color: CONFIG.INCIDENT_COLOR, truth: 'live 511', needsKey: !capabilities?.roadEvents, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    { key: 'camera', name: 'Public traffic cameras', initial: '◉', section: 'conditions', routes: [], color: CONFIG.CAMERA_COLOR, truth: 'live / viewer', needsKey: !capabilities?.cameras, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    { key: 'roads', name: 'Major roadways', initial: 'R', section: 'infrastructure', sectionName: 'Movement infrastructure', routes: [], color: CONFIG.ROAD_COLOR, truth: 'reference', countAsVehicle: false },
    { key: 'freight', name: 'Freight rail network', initial: 'FR', section: 'infrastructure', routes: [], color: CONFIG.FREIGHT_COLOR, truth: 'FRA reference', countAsVehicle: false },
  ];
}

function groupStartsOn(group, region) {
  if (group.needsKey) return false;
  if (group.key === 'bus' && STATE_BUS_DEFAULT_ON.has(region)) return true;
  return !CONFIG.DEFAULT_OFF_GROUPS.includes(group.key);
}

function applyRegionDefaults(region) {
  const bus = GROUPS.find((group) => group.key === 'bus');
  if (!bus || manualGroupOverrides.has(bus.key)) return;
  const startOn = groupStartsOn(bus, region);
  groupState.set(bus.key, startOn);
  rowInput(bus.key).checked = startOn;
  syncMaster();
  emitVisible();
}

/*
 * TODO(Max) — YOUR CALL: how should a vehicle's status read in its popup?
 *
 * The API gives three raw states: STOPPED_AT, INCOMING_AT, IN_TRANSIT_TO,
 * plus the name of the stop each refers to. The wording below is a working
 * default, but this is rider-facing UX copy and there are other valid takes —
 * e.g. "Approaching Davis" vs "Arriving at Davis" (INCOMING_AT fires ~a stop
 * away, so "arriving" can feel early), or "Next stop: Davis" vs "→ Davis".
 * Rewrite the cases to taste; `v.stopName` may be '' if the feed omits it.
 */
export function formatVehicleStatus(v) {
  const stop = v.stopName || 'station';
  switch (v.status) {
    case 'STOPPED_AT':
      return `Stopped at ${stop}`;
    case 'INCOMING_AT':
      return `Arriving at ${stop}`;
    case 'IN_TRANSIT_TO':
      return `Next stop ${stop}`;
    default:
      return 'In service';
  }
}

export function initPanel(routeInfo, visibleChangeHandler, regionChangeHandler, selectedRegion, capabilities) {
  GROUPS = buildGroups(routeInfo, capabilities);
  onVisibleChange = visibleChangeHandler;
  onRegionChange = regionChangeHandler;

  const regionSelect = el('region-select');
  for (const region of REGIONS) {
    const option = document.createElement('option');
    option.value = region.key;
    option.textContent = region.name;
    regionSelect.appendChild(option);
  }
  regionSelect.value = selectedRegion;
  renderRegionCopy(selectedRegion);
  regionSelect.addEventListener('change', () => {
    renderRegionCopy(regionSelect.value);
    applyRegionDefaults(regionSelect.value);
    onRegionChange(regionSelect.value);
    if (window.matchMedia('(max-width: 760px)').matches) {
      document.body.classList.remove('panel-open');
    }
  });

  for (const input of document.querySelectorAll('#data-status-filters input')) {
    statusState.set(input.value, input.checked);
    input.addEventListener('change', () => {
      statusState.set(input.value, input.checked);
      emitVisible();
    });
  }

  let lastSection = '';
  for (const group of GROUPS) {
    const startOn = groupStartsOn(group, selectedRegion);
    groupState.set(group.key, startOn);

    const row = document.createElement('div');
    row.className = 'line-row';
    row.dataset.key = group.key;
    row.style.setProperty('--line-color', group.color ?? '#39424c');
    if (group.needsKey) row.classList.add('needs-key');
    row.innerHTML = `
      <span class="bullet${group.darkText ? ' dark-text' : ''}">${group.initial}</span>
      <span class="line-name"><span class="line-label">${group.name}</span><span class="badge" hidden></span>
        ${group.truth ? `<span class="truth-tag">${group.truth}</span>` : ''}
        ${group.needsKey ? `<a class="get-key" href="${group.keyUrl}" target="_blank" rel="noopener" title="This layer needs the Motion gateway — see the README">${group.setupText ?? 'setup'}</a>` : ''}
      </span>
      <span class="count" data-count>–</span>
      <label class="switch">
        <input type="checkbox" ${startOn ? 'checked' : ''} ${group.needsKey ? 'disabled' : ''} aria-label="Toggle ${group.name}">
        <span class="knob"></span>
      </label>`;
    row.querySelector('input').addEventListener('change', (e) => {
      manualGroupOverrides.add(group.key);
      groupState.set(group.key, e.target.checked);
      syncMaster();
      emitVisible();
    });

    // Clicking the row itself (not the switch) flies the map to wherever this
    // fleet currently is — and switches the layer on first if it was off.
    // (Not for area layers like traffic, where "zoom to it" is meaningless.)
    if (!group.needsKey && group.zoomable !== false) {
      row.classList.add('zoomable');
      row.title = `Zoom to ${group.name}`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.switch') || e.target.closest('a')) return;
        if (!groupState.get(group.key)) {
          manualGroupOverrides.add(group.key);
          groupState.set(group.key, true);
          row.querySelector('input').checked = true;
          syncMaster();
          emitVisible();
        }
        const flew = focusGroup(group.key, group.routes);
        if (flew && window.matchMedia('(max-width: 760px)').matches) {
          document.body.classList.remove('panel-open');
        }
      });
    }
    const container = el(group.section === 'subway' ? 'layer-rows' : 'modal-rows');
    if (group.section !== 'subway' && group.section !== lastSection) {
      const heading = document.createElement('div');
      heading.className = 'layer-subhead';
      heading.textContent = group.sectionName ?? group.section;
      container.appendChild(heading);
      lastSection = group.section;
    }
    container.appendChild(row);
  }

  el('subway-master').addEventListener('change', (e) => {
    for (const group of GROUPS.filter((g) => g.section === 'subway')) {
      groupState.set(group.key, e.target.checked);
      rowInput(group.key).checked = e.target.checked;
    }
    emitVisible();
  });

  el('panel-toggle').addEventListener('click', () => {
    document.body.classList.toggle('panel-open');
  });

  setInterval(renderStatus, 1000);
  emitVisible();
}

function renderRegionCopy(key) {
  const name = REGIONS.find((region) => region.key === key)?.name ?? 'Boston only';
  el('region-eyebrow').textContent = `${name.replace(' only', '').toUpperCase()} · REAL-TIME TELEMETRY`;
  el('region-tagline').textContent = key === 'boston'
    ? 'Boston selected. Switch to any state or all New England.'
    : `${name} selected. Live points outside this boundary are hidden.`;
}

export function getRegion() {
  return el('region-select').value;
}

const rowInput = (key) =>
  document.querySelector(`.line-row[data-key="${key}"] input`);

function syncMaster() {
  el('subway-master').checked = GROUPS.filter((g) => g.section === 'subway').some(
    (g) => groupState.get(g.key),
  );
}

export function getVisibleGroups() {
  return GROUPS.filter((g) => groupState.get(g.key)).map((g) => g.key);
}

export function getVisibleStatuses() {
  return [...statusState.entries()].filter(([, visible]) => visible).map(([key]) => key);
}

function emitVisible() {
  onVisibleChange(getVisibleGroups(), getVisibleStatuses());
}

// ---- live counts / connection status --------------------------------------

// Every fleet reports its own group counts; they merge here.
export function updateCounts(partialByGroup, source = 'default') {
  if (!countsBySource.has(source)) countsBySource.set(source, new Map());
  const sourceCounts = countsBySource.get(source);
  for (const [group, n] of Object.entries(partialByGroup)) sourceCounts.set(group, n);
  renderCounts();
}

export function replaceCounts(partialByGroup, source) {
  countsBySource.set(source, new Map(Object.entries(partialByGroup)));
  renderCounts();
}

export function setScheduledCounts(partialByGroup) {
  scheduledCounts = new Map(Object.entries(partialByGroup));
  renderCounts();
}

function renderCounts() {
  for (const group of GROUPS) {
    const cell = document.querySelector(
      `.line-row[data-key="${group.key}"] [data-count]`,
    );
    if (!cell) continue;
    const values = [...countsBySource.values()]
      .map((sourceMap) => sourceMap.get(group.key))
      .filter((value) => value !== null && value !== undefined);
    const live = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    const scheduled = scheduledCounts.get(group.key) ?? 0;
    if (scheduled) {
      cell.textContent = live ? `${live} live · ${scheduled}r` : `${scheduled} routes`;
      cell.title = `${live ?? 0} live vehicle${live === 1 ? '' : 's'} · ${scheduled} scheduled route${scheduled === 1 ? '' : 's'}`;
    } else {
      cell.textContent = live ?? '–';
      cell.removeAttribute('title');
    }
  }
  hideOverlay();
  renderStatus();
}

// The MBTA poller is the app's heartbeat: it stamps lastUpdate.
export function updateStats({ byGroup, lastUpdate }) {
  status.lastUpdate = lastUpdate;
  updateCounts(byGroup, 'mbta');
}

export function updateStatus(state, detail = {}) {
  status.state = state;
  status.message = detail.message ?? '';
  status.retryAtMs = detail.retryInMs ? Date.now() + detail.retryInMs : null;
  renderStatus();
}

function totalCount() {
  return GROUPS.filter((group) => group.countAsVehicle !== false).reduce((total, group) => {
    const groupTotal = [...countsBySource.values()].reduce(
      (sum, sourceMap) => sum + (sourceMap.get(group.key) ?? 0),
      0,
    );
    return total + groupTotal;
  }, 0);
}

function renderStatus() {
  const dot = el('status-dot');
  const text = el('status-text');
  const age = status.lastUpdate
    ? Math.max(0, Math.round((Date.now() - status.lastUpdate) / 1000))
    : null;

  dot.className = `live-dot ${status.state}`;
  switch (status.state) {
    case 'live': {
      const total = totalCount();
      const hint = total === 0 ? ' (overnight shutdown?)' : '';
      text.textContent = `LIVE · ${total} vehicle${total === 1 ? '' : 's'}${hint} · ${age}s ago`;
      break;
    }
    case 'paused':
      text.textContent = 'PAUSED · tab in background';
      break;
    case 'error': {
      const wait = status.retryAtMs
        ? Math.max(0, Math.ceil((status.retryAtMs - Date.now()) / 1000))
        : 0;
      text.textContent = `OFFLINE · retrying in ${wait}s`;
      break;
    }
    default:
      text.textContent = 'CONNECTING…';
  }
}

// ---- alerts ---------------------------------------------------------------

const prettyEffect = (effect) => {
  const s = effect.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function renderAlerts(alerts) {
  el('alerts-count').textContent = alerts.length;

  // Worst severity per group drives the badge next to the group name.
  for (const group of GROUPS) {
    if (!group.routes.length) continue;
    const worst = Math.max(
      0,
      ...alerts
        .filter((a) => a.routes.some((r) => group.routes.includes(r)))
        .map((a) => a.severity),
    );
    const badge = document.querySelector(
      `.line-row[data-key="${group.key}"] .badge`,
    );
    if (!badge) continue;
    badge.hidden = worst < CONFIG.ALERT_LEVELS.minor;
    badge.className = `badge ${worst >= CONFIG.ALERT_LEVELS.major ? 'major' : 'minor'}`;
  }

  const list = el('alerts-list');
  list.innerHTML = '';
  if (!alerts.length) {
    list.innerHTML = '<li class="alert-empty">No active alerts — smooth sailing.</li>';
    return;
  }
  for (const a of alerts) {
    const li = document.createElement('li');
    li.className = `alert-item ${
      a.severity >= CONFIG.ALERT_LEVELS.major
        ? 'major'
        : a.severity >= CONFIG.ALERT_LEVELS.minor
          ? 'minor'
          : 'info'
    }`;
    // textContent (not innerHTML) — alert text is third-party API content.
    const effect = document.createElement('span');
    effect.className = 'alert-effect';
    effect.textContent = prettyEffect(a.effect);
    const text = document.createElement('span');
    text.className = 'alert-text';
    text.textContent = a.header;
    // Clicking an alert flies the map to what it affects.
    const canFocus = a.focus?.points?.length || a.routes?.length;
    if (canFocus) {
      li.classList.add('clickable');
      const button = document.createElement('button');
      button.className = 'alert-button';
      button.type = 'button';
      button.append(effect, text);
      li.appendChild(button);
      const go = () => {
        const flew = focusAlert(a);
        if (flew && window.matchMedia('(max-width: 760px)').matches) {
          document.body.classList.remove('panel-open');
        }
      };
      button.addEventListener('click', go);
    } else {
      li.append(effect, text);
    }
    list.appendChild(li);
  }
}

// ---- overlay --------------------------------------------------------------

export function setLoading(message) {
  el('overlay-text').textContent = message;
}

function hideOverlay() {
  el('overlay').classList.add('hidden');
}

export function fatal(err) {
  console.error(err);
  const overlay = el('overlay');
  overlay.classList.remove('hidden');
  overlay.classList.add('fatal');
  el('overlay-text').textContent =
    `Couldn't reach the MBTA feed (${err.message}). Check your connection and reload.`;
  updateStatus('error', {});
}
