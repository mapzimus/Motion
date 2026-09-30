// Conditions: NWS active weather alerts (severity-colored zone polygons) and
// FAA airport ground stops / delays drawn as rings on the FAA airport markers.
// Both feeds come through the Motion gateway, pause while the tab is hidden,
// and hand Extreme/Severe weather alerts to the service-alert panel.

import { CONFIG } from './config.js';
import { gatewayRegion } from './regions.js';
import {
  airportStatusCountForRegion,
  setAirportStatusData,
  setWeatherAlertsData,
  weatherAlertCountForRegion,
  weatherPanelAlertsForRegion,
} from './map.js';

function startPoller({ key, interval, enabled, url, apply }, onCounts) {
  if (!CONFIG.GATEWAY_BASE || !enabled) {
    onCounts({ [key]: null });
    return { refresh() {}, refreshCount() {} };
  }

  let timer = null;
  let inFlight = null;

  const poll = async () => {
    clearTimeout(timer);
    if (document.hidden) {
      timer = setTimeout(poll, interval);
      return;
    }
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const response = await fetch(`${CONFIG.GATEWAY_BASE}${url()}`, {
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error(`Motion gateway ${response.status}`);
        apply(await response.json());
      } catch (error) {
        console.warn(`${key} feed unavailable:`, error.message);
      } finally {
        inFlight = null;
      }
      timer = setTimeout(poll, interval);
    })();
    return inFlight;
  };

  poll();
  return {
    refresh() {
      clearTimeout(timer);
      poll();
    },
    refreshCount() {
      apply(null);
    },
  };
}

export function startConditions(onCounts, onAlerts, initialRegion, capabilities = {}) {
  let region = initialRegion;

  const publishWeather = () => {
    onCounts({ weather: weatherAlertCountForRegion() });
    onAlerts(weatherPanelAlertsForRegion());
  };

  const weather = startPoller({
    key: 'weather',
    interval: CONFIG.WEATHER_POLL_MS,
    enabled: capabilities.weatherAlerts,
    url: () => `/api/weather-alerts?region=${encodeURIComponent(gatewayRegion(region))}`,
    apply(collection) {
      if (collection) setWeatherAlertsData(collection);
      publishWeather();
    },
  }, onCounts);

  const airports = startPoller({
    key: 'airport-status',
    interval: CONFIG.AIRPORT_STATUS_POLL_MS,
    enabled: capabilities.airportStatus,
    url: () => '/api/airport-status',
    apply(payload) {
      if (payload) setAirportStatusData(payload);
      onCounts({ 'airport-status': airportStatusCountForRegion() });
    },
  }, onCounts);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    weather.refresh();
    airports.refresh();
  });

  return {
    setRegion(nextRegion) {
      region = nextRegion;
      // The gateway filters weather by state, so a region change refetches;
      // airport status is region-independent and only needs a recount.
      weather.refresh();
      airports.refreshCount();
    },
  };
}
