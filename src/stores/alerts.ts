import { signal, computed } from '@preact/signals';

interface Alert {
  severity: number;
  effect: string;
  header: string;
  routes: string[];
  badge?: string;
  focus?: { points?: unknown[] };
}

export const alertsBySource = signal<Map<string, Alert[]>>(new Map());

export const sortedAlerts = computed(() => {
  return [...alertsBySource.value.values()]
    .flat()
    .sort((a, b) => b.severity - a.severity);
});

export function setAlerts(source: string, alerts: Alert[]) {
  const next = new Map(alertsBySource.value);
  next.set(source, alerts);
  alertsBySource.value = next;
}
