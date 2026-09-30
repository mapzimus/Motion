import { signal } from '@preact/signals';

interface StatusState {
  state: string;
  lastUpdate: number | null;
  retryAtMs: number | null;
  message: string;
}

export const status = signal<StatusState>({
  state: 'connecting',
  lastUpdate: null,
  retryAtMs: null,
  message: '',
});

export function updateStats({ byGroup, lastUpdate }: { byGroup: Record<string, number>; lastUpdate: number }) {
  status.value = { ...status.value, lastUpdate };
}

export function updateStatus(state: string, detail: { message?: string; retryInMs?: number } = {}) {
  status.value = {
    state,
    lastUpdate: status.value.lastUpdate,
    retryAtMs: detail.retryInMs ? Date.now() + detail.retryInMs : null,
    message: detail.message ?? '',
  };
}
