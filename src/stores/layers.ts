import { signal, computed } from '@preact/signals';
import { ALL_STATUSES, GROUP_KEYS } from '../model/presets.js';
import type { GroupDef, SectionKey } from '../model/groups.js';

/** Every layer group the panel knows, in panel order. Set once at boot. */
export const groups = signal<GroupDef[]>([]);

export function setGroups(defs: GroupDef[]) {
  groups.value = defs;
}

export const groupOn = signal<Map<string, boolean>>(new Map());
export const manualOverrides = signal<Set<string>>(new Set());
export const statuses = signal<Map<string, boolean>>(
  new Map([['live', true], ['estimated', true], ['scheduled', true], ['reference', true]])
);

export const visibleGroups = computed(() =>
  [...groupOn.value.entries()].filter(([, on]) => on).map(([key]) => key)
);

export const visibleStatuses = computed(() =>
  [...statuses.value.entries()].filter(([, on]) => on).map(([key]) => key)
);

/** True when only live positions are shown (the "Live only" switch). */
export const liveOnly = computed(() => {
  const on = visibleStatuses.value;
  return on.length === 1 && on[0] === 'live';
});

export function setLiveOnly(on: boolean) {
  setVisibleStatusList(on ? ['live'] : ALL_STATUSES);
}

export function setGroupOn(key: string, on: boolean, manual = false) {
  if (groupOn.value.get(key) === on && (!manual || manualOverrides.value.has(key))) return;
  const next = new Map(groupOn.value);
  next.set(key, on);
  groupOn.value = next;
  if (manual) {
    const overrides = new Set(manualOverrides.value);
    overrides.add(key);
    manualOverrides.value = overrides;
  }
}

/** Switch several groups at once (one store update, one map update). */
export function setGroupsOn(keys: readonly string[], on: boolean, manual = false) {
  const next = new Map(groupOn.value);
  for (const key of keys) next.set(key, on);
  groupOn.value = next;
  if (manual) {
    const overrides = new Set(manualOverrides.value);
    for (const key of keys) overrides.add(key);
    manualOverrides.value = overrides;
  }
}

export function setStatus(key: string, on: boolean) {
  const next = new Map(statuses.value);
  next.set(key, on);
  statuses.value = next;
}

/** Replace every group's on/off state from the list of visible groups (panel order). */
export function setVisibleGroupList(list: readonly string[]) {
  const on = new Set(list);
  groupOn.value = new Map(GROUP_KEYS.map((key: string) => [key, on.has(key)]));
}

/** Replace the data-status filters from the list of visible statuses. */
export function setVisibleStatusList(list: readonly string[]) {
  const on = new Set(list);
  statuses.value = new Map(ALL_STATUSES.map((key: string) => [key, on.has(key)]));
}

export function initGroupState(_groups: Array<{ key: string; needsKey?: boolean }>, defaults: Map<string, boolean>) {
  groupOn.value = new Map(defaults);
}

export function setManualOverrides(keys: Iterable<string>) {
  manualOverrides.value = new Set(keys);
}

export function clearManualOverrides() {
  manualOverrides.value = new Set();
}

/** Sections the user has folded shut in the layer list. */
export const collapsedSections = signal<Set<SectionKey>>(new Set());

export function toggleSection(key: SectionKey) {
  const next = new Set(collapsedSections.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  collapsedSections.value = next;
}

/** Groups whose nested key block the user has folded shut. */
export const closedKeys = signal<Set<string>>(new Set());

export function toggleKey(group: string) {
  const next = new Set(closedKeys.value);
  if (next.has(group)) next.delete(group); else next.add(group);
  closedKeys.value = next;
}

/** Worst active alert per group ('major' | 'minor'), for the badge next to its name. */
export const alertBadges = signal<Map<string, 'major' | 'minor'>>(new Map());

export function setAlertBadges(badges: Map<string, 'major' | 'minor'>) {
  alertBadges.value = badges;
}

/** The preset whose result is still on screen; any manual change clears it. */
export const activePreset = signal<string | null>(null);

export function setActivePreset(key: string | null) {
  activePreset.value = key;
}

export function clearActivePreset() {
  if (activePreset.value !== null) activePreset.value = null;
}

export interface ZoomRequest { group: string; seq: number }

let zoomSeq = 0;
/** A row name click on a non-drillable group. The bridge flies the map there. */
export const zoomRequest = signal<ZoomRequest | null>(null);

export function askZoom(group: string) {
  zoomRequest.value = { group, seq: ++zoomSeq };
}
