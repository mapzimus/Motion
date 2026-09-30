import { signal } from '@preact/signals';
import { initialRegion, setActiveRegion } from '../feeds/regions.js';

export const region = signal(initialRegion());

export function setRegion(key: string) {
  region.value = key;
  setActiveRegion(key);
}
