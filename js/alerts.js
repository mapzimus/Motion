// Service alert poller. Alerts change slowly, so this runs on a gentler
// cadence than vehicles and simply hands the list to the UI callback.

import { CONFIG } from './config.js';
import { fetchAlerts } from './api.js';

export function startAlertPolling(onAlerts) {
  const poll = async () => {
    if (document.hidden) return;
    try {
      const alerts = await fetchAlerts();
      alerts.sort((a, b) => b.severity - a.severity);
      onAlerts(alerts);
    } catch {
      // Non-fatal: keep showing the last known alerts; vehicles poller owns
      // the visible connection-status reporting.
    }
  };
  poll();
  setInterval(poll, CONFIG.ALERT_POLL_MS);
}
