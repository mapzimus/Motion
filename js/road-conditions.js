// Official 511 road incidents and public traffic-camera locations/images.

import { CONFIG } from './config.js';
import {
  cameraCountForRegion,
  roadEventCountForRegion,
  setCameraData,
  setRoadEventsData,
} from './map.js';

function startFeed({ path, key, interval, enabled, setData, count }, onCounts) {
  if (!CONFIG.GATEWAY_BASE || !enabled) {
    onCounts({ [key]: null });
    return { refreshCount() {}, stop() {} };
  }

  let timer = null;
  let stopped = false;

  const poll = async () => {
    clearTimeout(timer);
    if (stopped) return;
    if (document.hidden) {
      timer = setTimeout(poll, interval);
      return;
    }
    try {
      const response = await fetch(`${CONFIG.GATEWAY_BASE}${path}`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Motion gateway ${response.status}`);
      setData(await response.json());
      onCounts({ [key]: count() });
    } catch (error) {
      console.warn(`${key} feed unavailable:`, error.message);
    }
    timer = setTimeout(poll, interval);
  };

  poll();
  return {
    refreshCount() {
      onCounts({ [key]: count() });
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

export function startRoadConditions(onCounts, capabilities = {}) {
  const feeds = [
    startFeed({
      path: '/api/road-events',
      key: 'incident',
      interval: CONFIG.ROAD_EVENT_POLL_MS,
      enabled: capabilities.roadEvents,
      setData: setRoadEventsData,
      count: roadEventCountForRegion,
    }, onCounts),
    startFeed({
      path: '/api/cameras',
      key: 'camera',
      interval: CONFIG.CAMERA_POLL_MS,
      enabled: capabilities.cameras,
      setData: setCameraData,
      count: cameraCountForRegion,
    }, onCounts),
  ];

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) feeds.forEach((feed) => feed.refreshCount());
  });

  return {
    setRegion() {
      feeds.forEach((feed) => feed.refreshCount());
    },
  };
}
