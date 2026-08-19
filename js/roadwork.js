// Current and upcoming official WZDx work zones across MA, ME, NH, and VT.

import { CONFIG } from './config.js';
import { roadworkCountForRegion, setRoadworkData } from './map.js';

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
