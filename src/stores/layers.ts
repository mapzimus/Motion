import { signal, computed } from '@preact/signals';
import { ALL_STATUSES, GROUP_KEYS } from '../model/presets.js';

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

export function setGroupOn(key: string, on: boolean, manual = false) {
  const next = new Map(groupOn.value);
  next.set(key, on);
  groupOn.value = next;
  if (manual) {
    const overrides = new Set(manualOverrides.value);
    overrides.add(key);
    manualOverrides.value = overrides;
  }
}

export function setStatus(key: string, on: boolean) {
  const next = new Map(statuses.value);
  next.set(key, on);
  statuses.value = next;
}

/** Replace every group's on/off state from the list of visible groups (panel order). */
export function setVisibleGroupList(groups: readonly string[]) {
  const on = new Set(groups);
  groupOn.value = new Map(GROUP_KEYS.map((key: string) => [key, on.has(key)]));
}

/** Replace the data-status filters from the list of visible statuses. */
export function setVisibleStatusList(list: readonly string[]) {
  const on = new Set(list);
  statuses.value = new Map(ALL_STATUSES.map((key: string) => [key, on.has(key)]));
}

export function initGroupState(groups: Array<{ key: string; needsKey?: boolean }>, defaults: Map<string, boolean>) {
  groupOn.value = new Map(defaults);
}

export function clearManualOverrides() {
  manualOverrides.value = new Set();
}
