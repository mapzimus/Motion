// Panel chrome that is still plain DOM: header, region picker (with scenes),
// basemap chips, mode chips, the Live-only switch, alert feed, connection
// status, loading states, and the mobile bottom sheet. The layer list itself
// is the LayerPanel Preact component; every group read/write goes through
// the layers store.

import { effect } from '@preact/signals';
import { CONFIG } from './feeds/config.js';
import { focusAlert, getBasemap, getDrillDown, getThreeD, setBasemap, setDrillDown, setThreeD } from './map/map.js';
import { REGIONS, REGION_GROUPS, hasSubway, regionInfo, regionName } from './feeds/regions.js';
import { SCENES, VEHICLE_PRESETS, resolvePreset } from './model/presets.js';
import { groupStartsOn } from './model/groups.js';
import {
  groups as groupDefs,
  groupOn,
  manualOverrides,
  visibleGroups,
  visibleStatuses,
  liveOnly,
  activePreset,
  setGroupOn,
  setGroupsOn,
  setManualOverrides,
  clearManualOverrides,
  setVisibleStatusList,
  setLiveOnly,
  setActivePreset,
  setAlertBadges,
} from './stores/layers.js';
import { countsBySource } from './stores/counts.js';

const el = (id) => document.getElementById(id);
const MOBILE = '(max-width: 760px)';
const isMobile = () => window.matchMedia(MOBILE).matches;

let onRegionChange = () => {};
let status = { state: 'connecting', lastUpdate: null, retryAtMs: null, message: '' };

const GROUPS = () => groupDefs.value;
const findGroup = (key) => GROUPS().find((group) => group.key === key);

// ---- bottom sheet (phones) -------------------------------------------------

const SHEET_STATES = ['peek', 'half', 'full'];

export function getSheet() {
  return document.body.dataset.sheet ?? 'peek';
}

export function setSheet(state) {
  if (!SHEET_STATES.includes(state)) return;
  document.body.dataset.sheet = state;
  el('sheet-grip')?.setAttribute('aria-expanded', String(state !== 'peek'));
  window.dispatchEvent(new CustomEvent('motion:sheet', { detail: { state } }));
}

function cycleSheet() {
  const index = SHEET_STATES.indexOf(getSheet());
  setSheet(SHEET_STATES[(index + 1) % SHEET_STATES.length]);
}

// Drag the grip: the sheet follows the pointer, then snaps to the nearest
// state on release. A short tap cycles instead.
function wireSheetGrip() {
  const grip = el('sheet-grip');
  const panel = el('panel');
  if (!grip || !panel) return;
  let startY = 0;
  let startHeight = 0;
  let dragging = false;
  let moved = false;

  const heightFor = (state) => {
    const probe = document.body.dataset.sheet;
    document.body.dataset.sheet = state;
    const height = panel.getBoundingClientRect().height;
    document.body.dataset.sheet = probe;
    return height;
  };

  grip.addEventListener('pointerdown', (event) => {
    if (!isMobile()) return;
    dragging = true;
    moved = false;
    startY = event.clientY;
    startHeight = panel.getBoundingClientRect().height;
    grip.setPointerCapture(event.pointerId);
    panel.classList.add('dragging');
  });
  grip.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const delta = startY - event.clientY;
    if (Math.abs(delta) > 6) moved = true;
    const height = Math.max(80, Math.min(window.innerHeight - 12, startHeight + delta));
    panel.style.height = `${height}px`;
  });
  const finish = (event) => {
    if (!dragging) return;
    dragging = false;
    const height = panel.getBoundingClientRect().height;
    panel.style.height = '';
    if (!moved) {
      panel.classList.remove('dragging');
      cycleSheet();
      return;
    }
    // Measure the snap heights while `.dragging` still disables the height
    // transition, or every probe reads the mid-transition height.
    const snaps = SHEET_STATES.map((state) => ({ state, h: heightFor(state) }));
    panel.classList.remove('dragging');
    snaps.sort((a, b) => Math.abs(a.h - height) - Math.abs(b.h - height));
    setSheet(snaps[0].state);
    event.preventDefault?.();
  };
  grip.addEventListener('pointerup', finish);
  grip.addEventListener('pointercancel', finish);
  grip.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      cycleSheet();
    }
  });
}

/** On a phone, drop the sheet to its peek strip so the map is visible. */
export function closePanelOnMobile() {
  if (isMobile()) setSheet('peek');
}

// ---- region defaults and presets -------------------------------------------

function applyRegionDefaults(region) {
  const bus = findGroup('bus');
  if (!bus || manualOverrides.value.has(bus.key)) return;
  setGroupOn(bus.key, groupStartsOn(bus, region));
}

// Every preset (the mode chips and the scenes) runs through here. A scene
// switches region first (which, like any region change, ends following),
// then applies its layers. Only groups a preset moves away from their region
// default count as manual overrides, so a later region change can still
// apply that region's bus default.
export function applyLayerPreset(preset) {
  const plan = resolvePreset(preset, { region: getRegion(), groups: GROUPS(), hasSubway });
  if (!plan) return false;
  // A preset chooses the layers itself. A drill left in place would keep the
  // map on the previous layer after the key and the switches had moved on.
  if (getDrillDown().group) setDrillDown(null);
  if (plan.region && plan.region !== getRegion()) selectRegion(plan.region);
  const region = getRegion();
  const next = new Map();
  const overrides = new Set(manualOverrides.value);
  if (plan.mode === 'default') {
    overrides.clear();
    for (const group of GROUPS()) next.set(group.key, groupStartsOn(group, region));
  } else {
    const on = new Set(plan.groups);
    for (const group of GROUPS()) {
      const checked = group.needsKey ? false : on.has(group.key);
      next.set(group.key, checked);
      if (checked !== groupStartsOn(group, region)) overrides.add(group.key);
      else overrides.delete(group.key);
    }
  }
  groupOn.value = next;
  setManualOverrides(overrides);
  if (plan.statuses) setVisibleStatusList(plan.statuses);
  setActivePreset(preset);
  return true;
}

function renderPresetButtons(containerId, presets) {
  const container = el(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (const preset of presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.layerPreset = preset.key;
    button.textContent = preset.label;
    button.setAttribute('aria-pressed', 'false');
    if (preset.region) button.title = `${regionName(preset.region)}: ${preset.label}`;
    // A preset whose every group needs the gateway would act like "Clear".
    const plan = resolvePreset(preset.key, { region: getRegion(), groups: GROUPS(), hasSubway });
    if (plan && preset.groups !== 'live' && preset.groups.length && !plan.groups.length) {
      button.disabled = true;
      button.title = 'Needs the Motion gateway';
    }
    button.addEventListener('click', () => applyLayerPreset(preset.key));
    container.appendChild(button);
  }
}

function syncPresetButtons() {
  const active = activePreset.value;
  for (const button of document.querySelectorAll('[data-layer-preset]')) {
    button.setAttribute('aria-pressed', String(button.dataset.layerPreset === active));
  }
}

// ---- region picker (with scenes) -------------------------------------------

function renderRegionOptions(select) {
  const scenes = document.createElement('optgroup');
  scenes.label = 'Scenes';
  for (const scene of SCENES) {
    const option = document.createElement('option');
    option.value = `scene:${scene.key}`;
    option.textContent = `${scene.label} · ${regionName(scene.region)}`;
    scenes.appendChild(option);
  }
  select.appendChild(scenes);
  for (const group of REGION_GROUPS) {
    const regions = REGIONS.filter((region) => region.group === group.key);
    if (!regions.length) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const region of regions) {
      const option = document.createElement('option');
      option.value = region.key;
      option.textContent = region.kind === 'state' ? `${region.name} (statewide)` : region.name;
      if (region.definition) option.title = region.definition;
      optgroup.appendChild(option);
    }
    select.appendChild(optgroup);
  }
}

// Switch region from code (search pick, scene) through the same path as the
// picker itself.
export function selectRegion(key) {
  const select = el('region-select');
  if (!select || !REGIONS.some((region) => region.key === key)) return false;
  if (select.value === key) return true;
  select.value = key;
  select.dispatchEvent(new Event('change'));
  return true;
}

function onRegionPick(select) {
  const value = select.value;
  if (value.startsWith('scene:')) {
    const scene = value.slice('scene:'.length);
    // Applying the scene selects its region, which sets the picker back to a region.
    applyLayerPreset(scene);
    select.value = getRegion();
    closePanelOnMobile();
    return;
  }
  setActivePreset(null);
  if (getDrillDown().group) setDrillDown(null);
  renderRegionCopy(value);
  applyRegionDefaults(value);
  onRegionChange(value);
  closePanelOnMobile();
}

function renderRegionCopy(key) {
  const region = regionInfo(key);
  const name = region?.name ?? regionName(key);
  const title = el('region-title');
  if (title) title.textContent = name;
  const about = el('region-about');
  if (about) {
    const definition = region?.definition ? `${region.definition}. ` : '';
    about.textContent = `${definition}Live points outside this boundary are hidden; they are clipped to Census boundaries.`;
  }
}

export function getRegion() {
  const value = el('region-select')?.value ?? '';
  return value.startsWith('scene:') ? lastRegion : value;
}
let lastRegion = '';

// Rider-facing wording for the three raw MBTA vehicle states. INCOMING_AT
// fires about a stop early, so it reads "Approaching" rather than "Arriving";
// IN_TRANSIT_TO reads "Heading to" so it never implies the train is there.
// `v.stopName` may be '' when the feed omits the stop.
export function formatVehicleStatus(v) {
  const stop = v.stopName;
  switch (v.status) {
    case 'STOPPED_AT':
      return stop ? `Stopped at ${stop}` : 'Stopped at a station';
    case 'INCOMING_AT':
      return stop ? `Approaching ${stop}` : 'Approaching next stop';
    case 'IN_TRANSIT_TO':
      return stop ? `Heading to ${stop}` : 'Between stops';
    default:
      return 'In service';
  }
}

// ---- init -----------------------------------------------------------------

/**
 * Wire the DOM panel. The group definitions must already be in the layers
 * store (boot calls setGroups first). Starts every group at its region
 * default; a permalink may override that right after.
 */
export function initPanel(regionChangeHandler, selectedRegion) {
  onRegionChange = regionChangeHandler;
  lastRegion = selectedRegion;

  const regionSelect = el('region-select');
  renderRegionOptions(regionSelect);
  regionSelect.value = selectedRegion;
  renderRegionCopy(selectedRegion);
  regionSelect.addEventListener('change', () => {
    onRegionPick(regionSelect);
    if (!regionSelect.value.startsWith('scene:')) lastRegion = regionSelect.value;
  });

  el('about-toggle')?.addEventListener('click', () => {
    const open = el('panel-about').hidden;
    el('panel-about').hidden = !open;
    el('about-toggle').setAttribute('aria-expanded', String(open));
  });

  renderBasemapOptions();

  groupOn.value = new Map(GROUPS().map((group) => [group.key, groupStartsOn(group, selectedRegion)]));
  clearManualOverrides();

  // "Everything" is the region's default layer set: the undo-my-filters chip.
  renderPresetButtons('vehicle-presets', [...VEHICLE_PRESETS, { key: 'default', label: 'Everything', groups: [] }]);
  effect(syncPresetButtons);

  const liveSwitch = el('live-only');
  liveSwitch?.addEventListener('change', () => {
    setLiveOnly(liveSwitch.checked);
    setActivePreset(null);
  });
  effect(() => {
    if (liveSwitch) liveSwitch.checked = liveOnly.value;
  });

  wireSheetGrip();
  // Publish the sheet's height so the zoom buttons, toasts and the map's
  // fit padding can stay clear of it whatever it holds.
  const panel = el('panel');
  if (panel && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      document.body.style.setProperty('--sheet-h', `${Math.round(panel.getBoundingClientRect().height)}px`);
    }).observe(panel);
  }
  if (isMobile()) setSheet('peek');
  window.matchMedia(MOBILE).addEventListener('change', (event) => {
    if (event.matches) setSheet('peek');
    else delete document.body.dataset.sheet;
  });

  setInterval(renderStatus, 1000);
  effect(() => {
    void countsBySource.value;
    renderStatus();
  });
}

function renderBasemapOptions() {
  const container = el('basemap-options');
  if (!container) return;
  container.innerHTML = '';
  const buttons = CONFIG.BASEMAPS.map((basemap) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.basemap = basemap.key;
    button.textContent = basemap.label;
    container.appendChild(button);
    return button;
  });
  const sync = () => {
    const active = getBasemap();
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.basemap === active));
    }
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      setBasemap(button.dataset.basemap);
      sync();
    });
  }
  sync();
  // 3D: building extrusions and vehicle meshes over any basemap.
  const threeD = document.createElement('button');
  threeD.type = 'button';
  threeD.className = 'three-d-toggle';
  threeD.textContent = '3D';
  threeD.title = 'Raise buildings to their heights and draw vehicles as 3D shapes';
  threeD.setAttribute('aria-pressed', String(getThreeD()));
  threeD.addEventListener('click', () => {
    const next = threeD.getAttribute('aria-pressed') !== 'true';
    setThreeD(next);
    threeD.setAttribute('aria-pressed', String(next));
  });
  container.appendChild(threeD);
}

// ---- visible state ----------------------------------------------------------

export function getVisibleGroups() {
  return visibleGroups.value;
}

export function getVisibleStatuses() {
  return visibleStatuses.value;
}

// Which groups start switched on for a region — permalinks store only the
// difference from this set.
export function getDefaultGroups(region = getRegion()) {
  return GROUPS().filter((group) => groupStartsOn(group, region)).map((group) => group.key);
}

// Restore a shared view: `on`/`off` are group keys to force, `statuses` (when
// given) is the full list of data-truth filters that should be checked.
export function applyVisibleState({ on = [], off = [], statuses = null } = {}) {
  const usable = (keys) => keys.filter((key) => findGroup(key) && !findGroup(key).needsKey);
  setGroupsOn(usable(on), true, true);
  setGroupsOn(usable(off), false, true);
  if (Array.isArray(statuses)) setVisibleStatusList(statuses);
}

// Follow mode switches a vehicle's layer (and its data-truth filter) back on
// if the rider hid it, through the same path a shared link uses.
export function ensureGroupVisible(key, dataStatus) {
  const group = findGroup(key);
  const needsGroup = Boolean(group) && !groupOn.value.get(key);
  const current = visibleStatuses.value;
  const needsStatus = Boolean(dataStatus) && !current.includes(dataStatus)
    && ['live', 'estimated', 'scheduled', 'reference'].includes(dataStatus);
  if (!needsGroup && !needsStatus) return;
  applyVisibleState({
    on: needsGroup ? [key] : [],
    statuses: needsStatus ? [...current, dataStatus] : null,
  });
}

// ---- connection status ------------------------------------------------------

// The MBTA poller is the app's heartbeat: it stamps lastUpdate.
export function updateStats({ lastUpdate }) {
  status.lastUpdate = lastUpdate;
  renderStatus();
}

export function updateStatus(state, detail = {}) {
  status.state = state;
  status.message = detail.message ?? '';
  status.retryAtMs = detail.retryInMs ? Date.now() + detail.retryInMs : null;
  renderStatus();
}

function totalCount() {
  const sources = countsBySource.value;
  return GROUPS().filter((group) => group.countAsVehicle !== false).reduce((total, group) => {
    let groupTotal = 0;
    for (const sourceMap of sources.values()) groupTotal += sourceMap.get(group.key) ?? 0;
    return total + groupTotal;
  }, 0);
}

function renderStatus() {
  const dot = el('status-dot');
  const text = el('status-text');
  if (!dot || !text) return;
  const age = status.lastUpdate
    ? Math.max(0, Math.round((Date.now() - status.lastUpdate) / 1000))
    : null;

  dot.className = `live-dot ${status.state}`;
  switch (status.state) {
    case 'live': {
      const total = totalCount();
      const hint = total === 0 ? ' (service may be closed overnight)' : '';
      text.textContent = `Live · ${total.toLocaleString()} vehicle${total === 1 ? '' : 's'}${hint} · updated ${age} s ago`;
      break;
    }
    case 'paused':
      text.textContent = 'Paused · tab in background';
      break;
    case 'error': {
      const wait = status.retryAtMs
        ? Math.max(0, Math.ceil((status.retryAtMs - Date.now()) / 1000))
        : 0;
      text.textContent = `Offline · retrying in ${wait} s`;
      break;
    }
    default:
      text.textContent = 'Connecting…';
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
  const badges = new Map();
  for (const group of GROUPS()) {
    if (!group.routes.length) continue;
    const worst = Math.max(
      0,
      ...alerts
        .filter((a) => a.routes.some((r) => group.routes.includes(r)))
        .map((a) => a.severity),
    );
    if (worst >= CONFIG.ALERT_LEVELS.major) badges.set(group.key, 'major');
    else if (worst >= CONFIG.ALERT_LEVELS.minor) badges.set(group.key, 'minor');
  }
  setAlertBadges(badges);

  const list = el('alerts-list');
  list.innerHTML = '';
  if (!alerts.length) {
    list.innerHTML = '<li class="alert-empty">No active alerts.</li>';
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
    // Non-transit sources (e.g. NWS weather) carry a small origin badge.
    if (a.badge) {
      const sourceBadge = document.createElement('span');
      sourceBadge.className = 'alert-source-badge';
      sourceBadge.textContent = a.badge;
      effect.prepend(sourceBadge);
    }
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
      button.addEventListener('click', () => {
        if (focusAlert(a)) closePanelOnMobile();
      });
    } else {
      li.append(effect, text);
    }
    list.appendChild(li);
  }
}

// ---- overlay --------------------------------------------------------------

// A message shows in the loading overlay; null lifts it. Counts arriving never
// lift it on their own, so the panel can fill in behind the overlay.
export function setLoading(message) {
  if (message === null) {
    el('overlay').classList.add('hidden');
    return;
  }
  el('overlay-text').textContent = message;
}

export function fatal(err) {
  console.error(err);
  const overlay = el('overlay');
  overlay.classList.remove('hidden');
  overlay.classList.add('fatal');
  el('overlay-text').textContent =
    `Motion couldn't start (${err.message}). Check your connection and reload.`;
  updateStatus('error', {});
}
