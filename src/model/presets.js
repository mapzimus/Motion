// Layer presets and scenes, as plain data plus one pure resolver. The panel
// (js/ui.js today, the Preact rewrite later) imports this module unchanged.
//
// Group keys are the layer keys built in js/ui.js buildGroups(). A preset
// switches on exactly its groups and switches everything else off; groups that
// need a gateway key the site doesn't have are skipped by the caller.

export const ALL_STATUSES = ['live', 'estimated', 'scheduled', 'reference'];

export const SUBWAY_GROUPS = ['red', 'orange', 'green', 'blue', 'silver', 'mattapan'];

// Every layer group key, in panel order. Tests check presets against this.
export const GROUP_KEYS = [
  ...SUBWAY_GROUPS,
  'commuter', 'bus', 'amtrak', 'local', 'taxi',
  'ferry', 'plane', 'air-service', 'airport', 'airport-status', 'airport-weather', 'tfr', 'airspace', 'vessel',
  'bike', 'bikeshare', 'walking', 'cycling',
  'traffic', 'roadwork', 'incident', 'camera', 'road-weather', 'message-sign', 'plow', 'weather',
  'roads', 'freight', 'border', 'heritage-rail', 'aerialway', 'park-ride', 'ev-charging', 'drawbridge',
];

// The Routes preset: scheduled ribbons for every mode, subway lines only where
// the region has a subway, and reference places hidden.
export const ROUTE_GROUPS = ['commuter', 'bus', 'amtrak', 'ferry'];

// "Show" row: vehicle presets grouped like the redesign's mode chips.
// `groups: 'live'` means every group whose truth tag says it is live.
export const VEHICLE_PRESETS = [
  { key: 'rail', label: 'Rail', groups: [...SUBWAY_GROUPS, 'commuter', 'amtrak'] },
  { key: 'buses', label: 'Buses', groups: ['bus', 'local'] },
  { key: 'water', label: 'Water', groups: ['ferry', 'vessel'] },
  { key: 'air', label: 'Air', groups: ['plane', 'air-service', 'airport', 'airport-status', 'airport-weather', 'tfr', 'airspace'] },
  { key: 'roads', label: 'Roads', groups: ['traffic', 'incident', 'roadwork', 'camera', 'road-weather', 'message-sign', 'plow'] },
  { key: 'bikes', label: 'Bikes', groups: ['bike', 'bikeshare', 'cycling'] },
  { key: 'all-live', label: 'All live', groups: 'live' },
];

// "Scenes" row: a region and its layers in one tap.
export const SCENES = [
  {
    key: 'boston-commute',
    label: 'Boston commute',
    region: 'greater-boston',
    groups: [...SUBWAY_GROUPS, 'commuter', 'bus', 'ferry'],
  },
  { key: 'harbor-watch', label: 'Harbor watch', region: 'boston', groups: ['ferry', 'vessel'] },
  {
    key: 'islands',
    label: 'Islands by sea & air',
    region: 'cape-islands',
    groups: ['ferry', 'vessel', 'air-service'],
  },
  {
    key: 'road-trip',
    label: 'Road trip',
    region: 'new-england',
    groups: ['traffic', 'incident', 'roadwork', 'camera', 'road-weather', 'message-sign', 'plow'],
  },
  { key: 'maine-islands', label: 'Maine islands', region: 'midcoast', groups: ['ferry', 'vessel'] },
];

export const presetByKey = (key) =>
  VEHICLE_PRESETS.find((preset) => preset.key === key)
  ?? SCENES.find((scene) => scene.key === key)
  ?? null;

const isLiveGroup = (group) => /\blive\b/.test(group.truth ?? '');

// Work out what a preset does, without touching the DOM.
//   key:       'default' | 'routes' | 'clear' | a vehicle preset | a scene
//   region:    the current region key
//   groups:    [{ key, truth?, needsKey? }] as built by the panel
//   hasSubway: (regionKey) => boolean
// Returns { mode, region, groups, statuses }:
//   mode 'default' -> restore each group's region default (groups is null)
//   mode 'exact'   -> switch on exactly `groups`, everything else off
//   region         -> the region to switch to first (scenes only), else null
//   statuses       -> the full data-truth filter to apply, or null to keep it
//                     (scenes always set one; vehicle presets keep it)
/**
 * @param {string} key
 * @param {{
 *   region?: string,
 *   groups?: Array<{ key: string, truth?: string, needsKey?: boolean }>,
 *   hasSubway?: (region: string) => boolean,
 * }} [options]
 */
export function resolvePreset(key, { region, groups = [], hasSubway = () => false } = {}) {
  const available = new Set(groups.filter((group) => !group.needsKey).map((group) => group.key));
  const keep = (keys) => keys.filter((groupKey) => available.has(groupKey));

  if (key === 'default') {
    return { mode: 'default', region: null, groups: null, statuses: [...ALL_STATUSES] };
  }
  if (key === 'clear') {
    return { mode: 'exact', region: null, groups: [], statuses: null };
  }
  if (key === 'routes') {
    const routeGroups = [...ROUTE_GROUPS, ...(hasSubway(region) ? SUBWAY_GROUPS : [])];
    return {
      mode: 'exact',
      region: null,
      groups: keep(routeGroups),
      statuses: ALL_STATUSES.filter((status) => status !== 'reference'),
    };
  }
  const preset = presetByKey(key);
  if (!preset) return null;
  const targetRegion = preset.region ?? null;
  // Subway rows carry no truth tag, so "live" lists them explicitly; the
  // hasSubway filter below drops them where there is no subway.
  let wanted = preset.groups === 'live'
    ? [...SUBWAY_GROUPS, ...groups.filter(isLiveGroup).map((group) => group.key)]
    : preset.groups;
  // Subway rows are hidden outside subway regions; don't switch them on there.
  if (!hasSubway(targetRegion ?? region)) {
    wanted = wanted.filter((groupKey) => !SUBWAY_GROUPS.includes(groupKey));
  }
  return {
    mode: 'exact',
    region: targetRegion,
    groups: keep(wanted),
    // Scenes set the whole view, so one without its own data-truth filter
    // shows everything; vehicle presets leave the filter as it is.
    statuses: preset.statuses ? [...preset.statuses] : (targetRegion ? [...ALL_STATUSES] : null),
  };
}
