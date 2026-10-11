// Legacy bridge: subscribes ui.js to signal store changes using @preact/signals
// effects. Exists only until B2 deletes ui.js — keeps the existing DOM rendering
// alive while stores are the single source of truth.

import { effect } from '@preact/signals';
import {
  loadingMessage,
  fatalError,
  status,
} from './stores/index.js';
import { sortedAlerts } from './stores/alerts.js';
import * as ui from './ui.js';

let started = false;

/**
 * Initialize all bridge effects. Call once the DOM panel is ready (boot does
 * this right after ui.initPanel, so feed counts reach the panel as they
 * arrive); later calls do nothing. Each effect watches one store signal and
 * forwards its value to the corresponding ui.js function.
 */
export function initLegacyBridge(): void {
  if (started) return;
  started = true;

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
      ui.updateStats({ lastUpdate: s.lastUpdate });
    }
  });
}
