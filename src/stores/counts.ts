import { signal, computed } from '@preact/signals';

// source -> Map(group key, count)
export const countsBySource = signal<Map<string, Map<string, number>>>(new Map());
export const scheduledCounts = signal<Map<string, number>>(new Map());
export const stationCounts = signal<Map<string, number>>(new Map());
export const referenceCounts = signal<Map<string, number>>(new Map());

export function updateCounts(partialByGroup: Record<string, number>, source = 'default') {
  const next = new Map(countsBySource.value);
  const sourceCounts = new Map(next.get(source) ?? []);
  for (const [group, n] of Object.entries(partialByGroup)) sourceCounts.set(group, n);
  next.set(source, sourceCounts);
  countsBySource.value = next;
}

export function replaceCounts(partialByGroup: Record<string, number>, source: string) {
  const next = new Map(countsBySource.value);
  next.set(source, new Map(Object.entries(partialByGroup)));
  countsBySource.value = next;
}

export function setScheduledCounts(partial: Record<string, number>) {
  scheduledCounts.value = new Map(Object.entries(partial));
}

export function setStationCounts(partial: Record<string, number>) {
  stationCounts.value = new Map(Object.entries(partial));
}

export function setReferenceCounts(partial: Record<string, number>) {
  referenceCounts.value = new Map(Object.entries(partial));
}

export function liveCountForGroup(key: string): number | null {
  const values = [...countsBySource.value.values()]
    .map(sourceMap => sourceMap.get(key))
    .filter((v): v is number => v !== null && v !== undefined);
  return values.length ? values.reduce((sum, v) => sum + v, 0) : null;
}
