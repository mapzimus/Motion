// Current and next-day MassDOT work zones, normalized by the Motion gateway.

import { CONFIG } from './config.js';
import { roadworkCountForRegion, setRoadworkData } from './map.js';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

export function startRoadwork(onCounts, initialRegion, enabled = true) {
  if (!CONFIG.GATEWAY_BASE || !enabled) {
    onCounts({ roadwork: null });
    return { setRegion() {} };
  }

  let region = initialRegion;
  let timer = null;

  const poll = async () => {
    clearTimeout(timer);
    if (document.hidden) {
      timer = setTimeout(poll, CONFIG.ROADWORK_POLL_MS);
      return;
    }
    if (!['boston', 'ma', 'new-england'].includes(region)) {
      setRoadworkData(EMPTY_FC);
      onCounts({ roadwork: 0 });
      timer = setTimeout(poll, CONFIG.ROADWORK_POLL_MS);
      return;
    }
    try {
      const response = await fetch(`${CONFIG.GATEWAY_BASE}/api/roadwork`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Motion gateway ${response.status}`);
      const collection = await response.json();
      setRoadworkData(collection);
      onCounts({ roadwork: roadworkCountForRegion() });
    } catch (error) {
      console.warn('Road-work feed unavailable:', error.message);
    }
    timer = setTimeout(poll, CONFIG.ROADWORK_POLL_MS);
  };

  poll();
  return {
    setRegion(nextRegion) {
      region = nextRegion;
      clearTimeout(timer);
      poll();
    },
  };
}
