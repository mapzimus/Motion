// Legacy bridge: subscribes ui.js to signal store changes using @preact/signals
// effects. Exists only until B2 deletes ui.js — keeps the existing DOM rendering
// alive while stores are the single source of truth.

import { effect } from '@preact/signals';
import {
  loadingMessage,
  fatalError,
  countsBySource,
  scheduledCounts,
  stationCounts,
  referenceCounts,
  status,
} from './stores/index.js';
import { sortedAlerts } from './stores/alerts.js';
import * as ui from './ui.js';

/**
 * Initialize all bridge effects. Call once after boot() has run and the DOM
 * panel is ready. Each effect watches one store signal and forwards its value
 * to the corresponding ui.js function.
 */
export function initLegacyBridge(): void {
  // Loading overlay
  effect(() => {
    const msg = loadingMessage.value;
    ui.setLoading(msg);
  });

  // Fatal error overlay
  effect(() => {
    const err = fatalError.value;
    if (err) ui.fatal(err);
  });

  // Per-source vehicle counts. On every change, push a full replaceCounts for
  // each source so ui.js stays in sync.
  effect(() => {
    const sources = countsBySource.value;
    for (const [source, groupCounts] of sources.entries()) {
      ui.replaceCounts(Object.fromEntries(groupCounts), source);
    }
  });

  // Scheduled route counts
  effect(() => {
    const counts = scheduledCounts.value;
    ui.setScheduledCounts(Object.fromEntries(counts));
  });

  // Station counts
  effect(() => {
    const counts = stationCounts.value;
    ui.setStationCounts(Object.fromEntries(counts));
  });

  // Reference counts
  effect(() => {
    const counts = referenceCounts.value;
    ui.setReferenceCounts(Object.fromEntries(counts));
  });

  // Sorted alerts
  effect(() => {
    const alerts = sortedAlerts.value;
    ui.renderAlerts(alerts);
  });

  // Connection status
  effect(() => {
    const s = status.value;
    ui.updateStatus(s.state, {
      message: s.message,
      retryInMs: s.retryAtMs ? Math.max(0, s.retryAtMs - Date.now()) : undefined,
    });
  });

  // Stats (lastUpdate) -> ui.updateStats. The store only keeps lastUpdate on
  // the status signal, so we derive it from there.
  effect(() => {
    const s = status.value;
    if (s.lastUpdate !== null) {
      ui.updateStats({ byGroup: {}, lastUpdate: s.lastUpdate });
    }
  });
}
