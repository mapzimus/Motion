import { signal, computed } from '@preact/signals';

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

export function initGroupState(groups: Array<{ key: string; needsKey?: boolean }>, defaults: Map<string, boolean>) {
  groupOn.value = new Map(defaults);
}

export function clearManualOverrides() {
  manualOverrides.value = new Set();
}
