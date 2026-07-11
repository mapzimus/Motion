// Panel UI: layer toggles, alert feed, connection status, loading states.

import { CONFIG } from './config.js';
import { focusAlert, focusGroup } from './map.js';

const el = (id) => document.getElementById(id);

let GROUPS = [];
const groupState = new Map();
const counts = new Map(); // group key -> latest count (null = needs key)
let onVisibleChange = () => {};
let status = { state: 'connecting', lastUpdate: null, retryAtMs: null, message: '' };

// Layer groups are built at init because route membership and colors come from
// the API (e.g. "every type-3 route that isn't Silver Line" = the bus group).
function buildGroups(routeInfo) {
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
    { key: 'commuter', name: 'Commuter Rail', initial: 'CR', section: 'modal', routes: routesOfType(2), color: colorOf(routesOfType(2)[0]) },
    { key: 'bus', name: 'Bus network', initial: 'B', section: 'modal', routes: routesOfType(3).filter((id) => !CONFIG.SILVER_ROUTES.includes(id)), color: '#ffc72c', darkText: true },
    { key: 'ferry', name: 'MBTA Ferries', initial: 'F', section: 'modal', routes: routesOfType(4), color: colorOf(routesOfType(4)[0]) ?? '#008eaa' },
    { key: 'amtrak', name: 'Amtrak', initial: 'A', section: 'modal', routes: [], color: CONFIG.AMTRAK_COLOR },
    { key: 'plane', name: 'Planes · Logan', initial: '✈', section: 'modal', routes: [], color: CONFIG.PLANE_COLOR },
    { key: 'vessel', name: 'Harbor traffic', initial: '⚓', section: 'modal', routes: [], color: CONFIG.VESSEL_COLOR, needsKey: !CONFIG.AIS_KEY },
  ];
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

export function initPanel(routeInfo, visibleChangeHandler) {
  GROUPS = buildGroups(routeInfo);
  onVisibleChange = visibleChangeHandler;

  for (const group of GROUPS) {
    const startOn = !CONFIG.DEFAULT_OFF_GROUPS.includes(group.key) && !group.needsKey;
    groupState.set(group.key, startOn);

    const row = document.createElement('div');
    row.className = 'line-row';
    row.dataset.key = group.key;
    row.style.setProperty('--line-color', group.color ?? '#39424c');
    if (group.needsKey) row.classList.add('needs-key');
    row.innerHTML = `
      <span class="bullet${group.darkText ? ' dark-text' : ''}">${group.initial}</span>
      <span class="line-name">${group.name}<span class="badge" hidden></span>
        ${group.needsKey ? '<a class="get-key" href="https://aisstream.io" target="_blank" rel="noopener" title="Live AIS needs a free aisstream.io key — see README">free key</a>' : ''}
      </span>
      <span class="count" data-count>–</span>
      <label class="switch">
        <input type="checkbox" ${startOn ? 'checked' : ''} ${group.needsKey ? 'disabled' : ''} aria-label="Toggle ${group.name}">
        <span class="knob"></span>
      </label>`;
    row.querySelector('input').addEventListener('change', (e) => {
      groupState.set(group.key, e.target.checked);
      syncMaster();
      emitVisible();
    });

    // Clicking the row itself (not the switch) flies the map to wherever this
    // fleet currently is — and switches the layer on first if it was off.
    if (!group.needsKey) {
      row.classList.add('zoomable');
      row.title = `Zoom to ${group.name}`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.switch') || e.target.closest('a')) return;
        if (!groupState.get(group.key)) {
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
    el(group.section === 'subway' ? 'layer-rows' : 'modal-rows').appendChild(row);
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

function emitVisible() {
  onVisibleChange(getVisibleGroups());
}

// ---- live counts / connection status --------------------------------------

// Every fleet reports its own group counts; they merge here.
export function updateCounts(partialByGroup) {
  for (const [group, n] of Object.entries(partialByGroup)) counts.set(group, n);
  for (const group of GROUPS) {
    const cell = document.querySelector(
      `.line-row[data-key="${group.key}"] [data-count]`,
    );
    if (!cell) continue;
    const n = counts.get(group.key);
    cell.textContent = n === null || n === undefined ? '–' : n;
  }
  hideOverlay();
  renderStatus();
}

// The MBTA poller is the app's heartbeat: it stamps lastUpdate.
export function updateStats({ byGroup, lastUpdate }) {
  status.lastUpdate = lastUpdate;
  updateCounts(byGroup);
}

export function updateStatus(state, detail = {}) {
  status.state = state;
  status.message = detail.message ?? '';
  status.retryAtMs = detail.retryInMs ? Date.now() + detail.retryInMs : null;
  renderStatus();
}

function totalCount() {
  let total = 0;
  for (const n of counts.values()) total += n ?? 0;
  return total;
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
    li.append(effect, text);

    // Clicking an alert flies the map to what it affects.
    const canFocus = a.focus?.points?.length || a.routes?.length;
    if (canFocus) {
      li.classList.add('clickable');
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      const go = () => {
        const flew = focusAlert(a);
        if (flew && window.matchMedia('(max-width: 760px)').matches) {
          document.body.classList.remove('panel-open');
        }
      };
      li.addEventListener('click', go);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
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
