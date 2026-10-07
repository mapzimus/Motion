// Panel UI: layer toggles, alert feed, connection status, loading states.

import { CONFIG } from './feeds/config.js';
import { focusAlert, focusGroup, getBasemap, setBasemap } from './map/map.js';
import { REGIONS, REGION_GROUPS, busDefaultOn, hasSubway, regionInfo, regionName } from './feeds/regions.js';
import { SCENES, VEHICLE_PRESETS, resolvePreset } from './model/presets.js';

const el = (id) => document.getElementById(id);

let GROUPS = [];
const groupState = new Map();
const countsBySource = new Map(); // source -> Map(group key, count)
const manualGroupOverrides = new Set();
const statusState = new Map([
  ['live', true],
  ['estimated', true],
  ['scheduled', true],
  ['reference', true],
]);
let scheduledCounts = new Map();
let stationCounts = new Map();
let referenceCounts = new Map();
let onVisibleChange = () => {};
let onRegionChange = () => {};
let status = { state: 'connecting', lastUpdate: null, retryAtMs: null, message: '' };

function setPanelOpen(open) {
  document.body.classList.toggle('panel-open', open);
  el('panel-toggle')?.setAttribute('aria-expanded', String(open));
}

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
    { key: 'commuter', name: 'Commuter & regional rail (MBTA, Metro-North, CTrail)', initial: 'CR', section: 'ground', sectionName: 'Ground & rail', routes: routesOfType(2), color: CONFIG.COMMUTER_COLOR, truth: 'live + schedule' },
    { key: 'bus', name: 'Buses, shuttles & coaches', initial: 'B', section: 'ground', routes: routesOfType(3).filter((id) => !CONFIG.SILVER_ROUTES.includes(id)), color: CONFIG.BUS_COLOR, darkText: true, truth: 'live + schedule' },
    { key: 'amtrak', name: 'Amtrak', initial: 'A', section: 'ground', routes: [], color: CONFIG.AMTRAK_COLOR, truth: 'live + schedule' },
    { key: 'local', name: 'On-demand & community services', initial: 'L', section: 'ground', routes: [], color: CONFIG.LOCAL_COLOR, darkText: true, truth: 'catalog', countAsVehicle: false },
    { key: 'taxi', name: 'Taxi & cab services', initial: 'TX', section: 'ground', routes: [], color: CONFIG.TAXI_COLOR, darkText: true, truth: 'directory', countAsVehicle: false },
    { key: 'ferry', name: 'Ferries & passenger boats', initial: 'F', section: 'airwater', sectionName: 'Air & water', routes: routesOfType(4), color: CONFIG.FERRY_COLOR, truth: 'live + schedule' },
    { key: 'plane', name: 'Live aircraft', initial: '✈', section: 'airwater', routes: [], color: CONFIG.PLANE_COLOR, truth: 'live', needsKey: !capabilities?.aircraft, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'setup' },
    { key: 'air-service', name: 'Island & regional air services', initial: 'AS', section: 'airwater', routes: [], color: CONFIG.PLANE_COLOR, truth: 'schedule/catalog', countAsVehicle: false },
    { key: 'airport', name: 'Airports & landing facilities', initial: 'AP', section: 'airwater', routes: [], color: CONFIG.AIRPORT_COLOR, truth: 'FAA reference', countAsVehicle: false },
    { key: 'airport-status', name: 'Airport delays (FAA)', initial: '✈', section: 'airwater', routes: [], color: CONFIG.AIRPORT_STATUS_COLORS['ground-delay'], truth: 'live', needsKey: !capabilities?.airportStatus, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    // Aviation conditions: METAR flight categories, TFRs, and charted airspace.
    { key: 'airport-weather', name: 'Airport weather (METAR)', initial: 'WX', section: 'airwater', routes: [], color: CONFIG.FLIGHT_CATEGORY_COLORS.VFR, darkText: true, truth: 'live', needsKey: !capabilities?.airportWeather, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    { key: 'tfr', name: 'Temporary flight restrictions (FAA)', initial: 'TFR', section: 'airwater', routes: [], color: CONFIG.TFR_COLORS.SECURITY, truth: 'live', needsKey: !capabilities?.tfrs, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    { key: 'airspace', name: 'Airspace (Class B/C/D & special use)', initial: '◇', section: 'airwater', routes: [], color: CONFIG.AIRSPACE_COLORS.B, truth: 'FAA reference', countAsVehicle: false },
    { key: 'vessel', name: 'Live vessels (AIS)', initial: '⚓', section: 'airwater', routes: [], color: CONFIG.VESSEL_COLOR, truth: 'live', needsKey: !capabilities?.ais, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'AIS key' },
    { key: 'bike', name: 'Public bike & scooter share', initial: 'b', section: 'shared', sectionName: 'Shared & active travel', routes: [], color: CONFIG.BIKE_COLOR, truth: 'live' },
    { key: 'bikeshare', name: 'Other bike-share systems (no live feed)', initial: 'BS', section: 'shared', routes: [], color: CONFIG.BIKESHARE_REF_COLOR, darkText: true, truth: 'operator reference', countAsVehicle: false },
    { key: 'walking', name: 'Marked walking & hiking routes', initial: 'W', section: 'shared', routes: [], color: CONFIG.WALK_COLOR, truth: 'OSM routes', countAsVehicle: false, zoomable: false, overlay: true },
    { key: 'cycling', name: 'Marked cycling routes', initial: 'C', section: 'shared', routes: [], color: CONFIG.CYCLE_COLOR, truth: 'OSM routes', countAsVehicle: false, zoomable: false, overlay: true },
    { key: 'traffic', name: 'Live congestion speeds', initial: '≋', section: 'conditions', sectionName: 'Conditions & alerts', routes: [], color: CONFIG.INCIDENT_COLOR, truth: 'live 511', needsKey: !capabilities?.traffic, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false, zoomable: false, overlay: true },
    { key: 'roadwork', name: 'Work zones & construction projects', initial: '!', section: 'conditions', routes: [], color: CONFIG.ROADWORK_COLOR, truth: 'WZDx lines · CT construction projects · CTroads lane closures', needsKey: !capabilities?.roadwork, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    { key: 'incident', name: 'Traffic incidents', initial: '!', section: 'conditions', routes: [], color: CONFIG.INCIDENT_COLOR, truth: 'live 511', needsKey: !capabilities?.roadEvents, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    { key: 'camera', name: 'Public traffic cameras', initial: '◉', section: 'conditions', routes: [], color: CONFIG.CAMERA_COLOR, truth: 'live / viewer', needsKey: !capabilities?.cameras, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    { key: 'road-weather', name: 'Road weather stations', initial: 'RW', section: 'conditions', routes: [], color: CONFIG.ROAD_WEATHER_COLOR, darkText: true, truth: 'live', needsKey: !capabilities?.roadWeather, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    { key: 'message-sign', name: 'Highway message signs', initial: 'MS', section: 'conditions', routes: [], color: CONFIG.MESSAGE_SIGN_COLOR, darkText: true, truth: 'live', needsKey: !capabilities?.messageSigns, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    { key: 'plow', name: 'Snowplows', initial: 'SP', section: 'conditions', routes: [], color: CONFIG.PLOW_COLOR, truth: 'live + reference', countAsVehicle: false },
    { key: 'weather', name: 'Weather alerts (NWS)', initial: '⚠', section: 'conditions', routes: [], color: CONFIG.WEATHER_COLORS.moderate, darkText: true, truth: 'live', needsKey: !capabilities?.weatherAlerts, keyUrl: 'https://github.com/mapzimus/Motion#gateway-setup', setupText: 'gateway', countAsVehicle: false },
    { key: 'roads', name: 'Major roadways', initial: 'R', section: 'infrastructure', sectionName: 'Movement infrastructure', routes: [], color: CONFIG.ROAD_COLOR, truth: 'reference', countAsVehicle: false },
    { key: 'freight', name: 'Freight rail network', initial: 'FR', section: 'infrastructure', routes: [], color: CONFIG.FREIGHT_COLOR, truth: 'FRA reference', countAsVehicle: false },
    { key: 'border', name: 'Canada border crossings', initial: 'CB', section: 'infrastructure', routes: [], color: CONFIG.BORDER_COLOR, darkText: true, truth: 'CBSA reference', countAsVehicle: false },
    { key: 'heritage-rail', name: 'Heritage & scenic railroads', initial: 'HR', section: 'infrastructure', routes: [], color: CONFIG.HERITAGE_RAIL_COLOR, truth: 'operator reference', countAsVehicle: false },
    { key: 'aerialway', name: 'Ski lifts, gondolas & tramways', initial: 'AW', section: 'infrastructure', routes: [], color: CONFIG.AERIALWAY_COLOR, truth: 'OSM reference', countAsVehicle: false },
    { key: 'park-ride', name: 'Park & ride lots', initial: 'PR', section: 'infrastructure', routes: [], color: CONFIG.PARK_RIDE_COLOR, darkText: true, truth: 'state DOT reference', countAsVehicle: false },
    { key: 'ev-charging', name: 'Public EV charging', initial: 'EV', section: 'infrastructure', routes: [], color: CONFIG.EV_CHARGING_COLOR, darkText: true, truth: 'AFDC reference', countAsVehicle: false },
    { key: 'drawbridge', name: 'Drawbridges & movable bridges', initial: 'DB', section: 'infrastructure', routes: [], color: CONFIG.DRAWBRIDGE_COLOR, darkText: true, truth: 'USCG reference', countAsVehicle: false },
  ];
}

function groupStartsOn(group, region) {
  if (group.needsKey) return false;
  if (group.key === 'bus' && busDefaultOn(region)) return true;
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

function setGroupChecked(group, checked, manual = false) {
  if (!group || group.needsKey) return;
  groupState.set(group.key, checked);
  const input = rowInput(group.key);
  if (input) input.checked = checked;
  if (manual) manualGroupOverrides.add(group.key);
}

// The preset whose result is still on screen; any manual change clears it.
function setActivePreset(key) {
  for (const button of document.querySelectorAll('[data-layer-preset]')) {
    button.setAttribute('aria-pressed', String(button.dataset.layerPreset === key));
  }
}

// Every preset — Default/Routes/Clear, the vehicle presets and the scenes —
// runs through here. A scene switches region first (which, like any region
// change, ends following), then applies its layers. Only groups a preset
// moves away from their region default count as manual overrides, so a later
// region change can still apply that region's bus default.
export function applyLayerPreset(preset) {
  const plan = resolvePreset(preset, { region: getRegion(), groups: GROUPS, hasSubway });
  if (!plan) return false;
  if (plan.region && plan.region !== getRegion()) selectRegion(plan.region);
  const region = getRegion();
  if (plan.mode === 'default') {
    manualGroupOverrides.clear();
    for (const group of GROUPS) setGroupChecked(group, groupStartsOn(group, region));
  } else {
    const on = new Set(plan.groups);
    for (const group of GROUPS) {
      const checked = on.has(group.key);
      const differsFromDefault = checked !== groupStartsOn(group, region);
      setGroupChecked(group, checked, differsFromDefault);
      if (!differsFromDefault) manualGroupOverrides.delete(group.key);
    }
  }
  if (plan.statuses) {
    for (const [key] of statusState) statusState.set(key, plan.statuses.includes(key));
  }
  for (const input of document.querySelectorAll('#data-status-filters input')) {
    input.checked = statusState.get(input.value);
  }
  syncMaster();
  emitVisible();
  setActivePreset(preset);
  return true;
}

function renderPresetButtons(containerId, presets) {
  const container = el(containerId);
  if (!container) return;
  for (const preset of presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.layerPreset = preset.key;
    button.textContent = preset.label;
    button.setAttribute('aria-pressed', 'false');
    if (preset.region) button.title = `${regionName(preset.region)}: ${preset.label}`;
    // A preset whose every group needs the gateway would act like "Clear".
    const plan = resolvePreset(preset.key, { region: getRegion(), groups: GROUPS, hasSubway });
    if (plan && preset.groups !== 'live' && preset.groups.length && !plan.groups.length) {
      button.disabled = true;
      button.title = 'Needs the Motion gateway';
    }
    container.appendChild(button);
  }
}

function renderRegionOptions(select) {
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

export function initPanel(routeInfo, visibleChangeHandler, regionChangeHandler, selectedRegion, capabilities) {
  GROUPS = buildGroups(routeInfo, capabilities);
  onVisibleChange = visibleChangeHandler;
  onRegionChange = regionChangeHandler;

  const regionSelect = el('region-select');
  renderRegionOptions(regionSelect);
  regionSelect.value = selectedRegion;
  renderRegionCopy(selectedRegion);
  regionSelect.addEventListener('change', () => {
    setActivePreset(null);
    renderRegionCopy(regionSelect.value);
    applyRegionDefaults(regionSelect.value);
    onRegionChange(regionSelect.value);
    if (window.matchMedia('(max-width: 760px)').matches) {
      setPanelOpen(false);
    }
  });

  renderBasemapOptions();

  for (const input of document.querySelectorAll('#data-status-filters input')) {
    statusState.set(input.value, input.checked);
    input.addEventListener('change', () => {
      statusState.set(input.value, input.checked);
      setActivePreset(null);
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
      setActivePreset(null);
      syncMaster();
      emitVisible();
    });

    // Clicking the row itself (not the switch) flies the map to wherever this
    // fleet currently is — and switches the layer on first if it was off.
    // (Not for area layers like traffic, where "zoom to it" is meaningless.)
    if (!group.needsKey && group.zoomable !== false) {
      row.classList.add('zoomable');
      row.title = `Zoom to ${group.name}`;
      row.addEventListener('click', async (e) => {
        if (e.target.closest('.switch') || e.target.closest('a')) return;
        if (!groupState.get(group.key)) {
          manualGroupOverrides.add(group.key);
          groupState.set(group.key, true);
          row.querySelector('input').checked = true;
          syncMaster();
          emitVisible();
        }
        const flew = await focusGroup(group.key, group.routes);
        if (flew && window.matchMedia('(max-width: 760px)').matches) {
          setPanelOpen(false);
        }
      });
    }
    const container = el(group.section === 'subway' ? 'layer-rows' : 'modal-rows');
    if (group.section !== 'subway' && group.section !== lastSection) {
      const heading = document.createElement('button');
      heading.type = 'button';
      heading.className = 'layer-subhead';
      heading.dataset.section = group.section;
      heading.setAttribute('aria-expanded', 'true');
      heading.innerHTML = `<span>${group.sectionName ?? group.section}</span><span class="section-chevron" aria-hidden="true">⌄</span>`;
      heading.addEventListener('click', () => {
        const expanded = heading.getAttribute('aria-expanded') === 'true';
        heading.setAttribute('aria-expanded', String(!expanded));
        for (const sectionRow of container.querySelectorAll(`.line-row[data-section="${group.section}"]`)) {
          sectionRow.hidden = expanded;
        }
      });
      container.appendChild(heading);
      lastSection = group.section;
    }
    row.dataset.section = group.section;
    container.appendChild(row);
  }

  renderPresetButtons('vehicle-presets', VEHICLE_PRESETS);
  renderPresetButtons('scene-presets', SCENES);
  for (const button of document.querySelectorAll('[data-layer-preset]')) {
    button.addEventListener('click', () => {
      applyLayerPreset(button.dataset.layerPreset);
      // A scene sets the whole view, like picking a region, so get the panel out
      // of the way; layer presets stay open for further tuning.
      if (SCENES.some((scene) => scene.key === button.dataset.layerPreset)) closePanelOnMobile();
    });
  }

  el('subway-master').addEventListener('change', (e) => {
    for (const group of GROUPS.filter((g) => g.section === 'subway')) {
      groupState.set(group.key, e.target.checked);
      rowInput(group.key).checked = e.target.checked;
    }
    setActivePreset(null);
    emitVisible();
  });

  el('panel-toggle').addEventListener('click', () => {
    setPanelOpen(!document.body.classList.contains('panel-open'));
  });

  setInterval(renderStatus, 1000);
  renderRegionAvailability(selectedRegion);
  emitVisible();
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
}

function renderRegionCopy(key) {
  const region = regionInfo(key);
  const name = region?.name ?? regionName(key);
  el('region-eyebrow').textContent = `Live map · ${name}`;
  const definition = region?.definition ? `${region.definition}. ` : '';
  el('region-tagline').textContent =
    `${definition}Live points outside this boundary are hidden.`;
  renderRegionAvailability(key);
}

function renderRegionAvailability(key) {
  const showSubway = hasSubway(key);
  el('subway-master')?.closest('.master-row')?.classList.toggle('region-hidden', !showSubway);
  for (const group of GROUPS.filter((item) => item.section === 'subway')) {
    document.querySelector(`.line-row[data-key="${group.key}"]`)?.classList.toggle('region-hidden', !showSubway);
  }
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

// Which groups start switched on for a region — permalinks store only the
// difference from this set.
export function getDefaultGroups(region = getRegion()) {
  return GROUPS.filter((group) => groupStartsOn(group, region)).map((group) => group.key);
}

// Restore a shared view: `on`/`off` are group keys to force, `statuses` (when
// given) is the full list of data-truth filters that should be checked.
export function applyVisibleState({ on = [], off = [], statuses = null } = {}) {
  for (const key of on) setGroupChecked(GROUPS.find((group) => group.key === key), true, true);
  for (const key of off) setGroupChecked(GROUPS.find((group) => group.key === key), false, true);
  if (Array.isArray(statuses)) {
    for (const [key] of statusState) statusState.set(key, statuses.includes(key));
    for (const input of document.querySelectorAll('#data-status-filters input')) {
      input.checked = statusState.get(input.value);
    }
  }
  syncMaster();
  emitVisible();
}

function emitVisible() {
  onVisibleChange(getVisibleGroups(), getVisibleStatuses());
}

// Follow mode switches a vehicle's layer (and its data-truth filter) back on
// if the rider hid it, through the same path a shared link uses.
export function ensureGroupVisible(key, dataStatus) {
  const group = GROUPS.find((candidate) => candidate.key === key);
  const needsGroup = Boolean(group) && !groupState.get(key);
  const needsStatus = Boolean(dataStatus) && statusState.has(dataStatus) && !statusState.get(dataStatus);
  if (!needsGroup && !needsStatus) return;
  applyVisibleState({
    on: needsGroup ? [key] : [],
    statuses: needsStatus ? [...getVisibleStatuses(), dataStatus] : null,
  });
}

export function closePanelOnMobile() {
  if (window.matchMedia('(max-width: 760px)').matches) setPanelOpen(false);
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

export function setStationCounts(partialByGroup) {
  stationCounts = new Map(Object.entries(partialByGroup));
  renderCounts();
}

export function setReferenceCounts(partialByGroup) {
  referenceCounts = new Map(Object.entries(partialByGroup));
  renderCounts();
}

function liveCountForGroup(key) {
  const values = [...countsBySource.values()]
    .map((sourceMap) => sourceMap.get(key))
    .filter((value) => value !== null && value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function renderCounts() {
  for (const group of GROUPS) {
    const cell = document.querySelector(
      `.line-row[data-key="${group.key}"] [data-count]`,
    );
    if (!cell) continue;
    const live = liveCountForGroup(group.key);
    const scheduled = scheduledCounts.get(group.key) ?? 0;
    const stations = stationCounts.get(group.key) ?? 0;
    const references = referenceCounts.get(group.key) ?? 0;
    const secondary = [
      scheduled ? `${scheduled} route${scheduled === 1 ? '' : 's'}` : '',
      stations ? `${stations} stop${stations === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ');
    if (secondary) {
      cell.innerHTML = `${live ? `<strong>${live} live</strong>` : ''}<small>${secondary}</small>`;
      cell.title = `${live ?? 0} live vehicle${live === 1 ? '' : 's'} · ${secondary}`;
    } else if (references && live) {
      cell.innerHTML = `<strong>${live} live</strong><small>${references} mapped</small>`;
      cell.title = `${live} live · ${references} mapped reference features`;
    } else if (references) {
      cell.innerHTML = `<strong>${references}</strong><small>mapped</small>`;
      cell.title = `${references} mapped reference feature${references === 1 ? '' : 's'}`;
    } else if (group.overlay) {
      cell.textContent = 'overlay';
      cell.title = 'Map overlay; it has no feature count';
    } else {
      cell.textContent = live ?? '–';
      cell.removeAttribute('title');
    }
  }
  renderStatus();
  renderOverviewStats();
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

function renderOverviewStats() {
  const set = (id, value) => { if (el(id)) el(id).textContent = value.toLocaleString(); };
  set('stat-live', totalCount());
  set('stat-routes', [...scheduledCounts.values()].reduce((sum, value) => sum + value, 0));
  set('stat-stations', [...stationCounts.values()].reduce((sum, value) => sum + value, 0));
  set('stat-reference', [...referenceCounts.values()].reduce((sum, value) => sum + value, 0));
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
      const go = () => {
        const flew = focusAlert(a);
        if (flew && window.matchMedia('(max-width: 760px)').matches) {
          setPanelOpen(false);
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

// A message shows in the loading overlay; null lifts it. Counts arriving never
// lift it on their own, so the panel can fill in behind the overlay.
export function setLoading(message) {
  if (message === null) {
    hideOverlay();
    return;
  }
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
    `Motion couldn't start (${err.message}). Check your connection and reload.`;
  updateStatus('error', {});
}
