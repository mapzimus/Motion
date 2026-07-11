// Panel UI: layer toggles, alert feed, connection status, loading states.

import { CONFIG } from './config.js';

// The rider-facing line groups. Branches toggle together (Green B-E, the six
// Silver services) because that's how riders think of them; colors come from
// the API at init. Mattapan is branded Red but is its own light-rail trolley,
// so it keeps its own row.
const LINE_GROUPS = [
  { key: 'red', name: 'Red Line', initial: 'R', routes: ['Red'] },
  { key: 'orange', name: 'Orange Line', initial: 'O', routes: ['Orange'] },
  { key: 'green', name: 'Green Line', initial: 'G', routes: ['Green-B', 'Green-C', 'Green-D', 'Green-E'] },
  { key: 'blue', name: 'Blue Line', initial: 'B', routes: ['Blue'] },
  { key: 'silver', name: 'Silver Line', initial: 'SL', routes: ['741', '742', '743', '746', '749', '751'] },
  { key: 'mattapan', name: 'Mattapan Trolley', initial: 'M', routes: ['Mattapan'] },
];

const el = (id) => document.getElementById(id);

const groupState = new Map(LINE_GROUPS.map((g) => [g.key, true]));
let onVisibleChange = () => {};
let status = { state: 'connecting', count: 0, lastUpdate: null, retryAtMs: null, message: '' };

/*
 * TODO(Max) — YOUR CALL: how should a train's status read in its popup?
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
  onVisibleChange = visibleChangeHandler;

  const container = el('layer-rows');
  for (const group of LINE_GROUPS) {
    const color = routeInfo.get(group.routes[0])?.color ?? '#8a939c';
    const row = document.createElement('div');
    row.className = 'line-row';
    row.dataset.key = group.key;
    row.style.setProperty('--line-color', color);
    row.innerHTML = `
      <span class="bullet">${group.initial}</span>
      <span class="line-name">${group.name}<span class="badge" hidden></span></span>
      <span class="count" data-count>–</span>
      <label class="switch">
        <input type="checkbox" checked aria-label="Toggle ${group.name}">
        <span class="knob"></span>
      </label>`;
    row.querySelector('input').addEventListener('change', (e) => {
      groupState.set(group.key, e.target.checked);
      syncMaster();
      emitVisible();
    });
    container.appendChild(row);
  }

  el('subway-master').addEventListener('change', (e) => {
    for (const group of LINE_GROUPS) {
      groupState.set(group.key, e.target.checked);
      rowInput(group.key).checked = e.target.checked;
    }
    emitVisible();
  });

  el('panel-toggle').addEventListener('click', () => {
    document.body.classList.toggle('panel-open');
  });

  setInterval(renderStatus, 1000);
}

const rowInput = (key) =>
  document.querySelector(`.line-row[data-key="${key}"] input`);

function syncMaster() {
  el('subway-master').checked = [...groupState.values()].some(Boolean);
}

function emitVisible() {
  const visible = LINE_GROUPS.filter((g) => groupState.get(g.key)).flatMap(
    (g) => g.routes,
  );
  onVisibleChange(visible);
}

// ---- live stats / connection status -------------------------------------

export function updateStats({ count, byRoute }) {
  status.count = count;
  status.lastUpdate = Date.now();
  for (const group of LINE_GROUPS) {
    const n = group.routes.reduce((sum, r) => sum + (byRoute[r] ?? 0), 0);
    document.querySelector(
      `.line-row[data-key="${group.key}"] [data-count]`,
    ).textContent = n;
  }
  hideOverlay();
  renderStatus();
}

export function updateStatus(state, detail = {}) {
  status.state = state;
  status.message = detail.message ?? '';
  status.retryAtMs = detail.retryInMs ? Date.now() + detail.retryInMs : null;
  renderStatus();
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
      const vehicles = `${status.count} vehicle${status.count === 1 ? '' : 's'}`;
      const hint = status.count === 0 ? ' (overnight shutdown?)' : '';
      text.textContent = `LIVE · ${vehicles}${hint} · ${age}s ago`;
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

  // Worst severity per line group drives the badge next to the line name.
  for (const group of LINE_GROUPS) {
    const worst = Math.max(
      0,
      ...alerts
        .filter((a) => a.routes.some((r) => group.routes.includes(r)))
        .map((a) => a.severity),
    );
    const badge = document.querySelector(
      `.line-row[data-key="${group.key}"] .badge`,
    );
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
