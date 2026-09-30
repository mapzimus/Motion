import { signal } from '@preact/signals';

export const capabilities = signal<Record<string, unknown>>({});

export function setCapabilities(caps: Record<string, unknown>) {
  capabilities.value = caps;
}
