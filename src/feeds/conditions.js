// Conditions: NWS active weather alerts (severity-colored zone polygons) and
// FAA airport ground stops / delays drawn as rings on the FAA airport markers,
// METAR flight-category dots, and FAA TFR polygons. Every feed comes through
// the Motion gateway and pauses while the tab is hidden; Extreme/Severe
// weather alerts also go to the service-alert panel.

import { CONFIG } from './config.js';
import { gatewayRegion } from './regions.js';
import {
  airportStatusCountForRegion,
  airportWeatherCountForRegion,
  setAirportStatusData,
  setAirportWeatherData,
  setTfrData,
  setWeatherAlertsData,
  tfrCountForRegion,
  weatherAlertCountForRegion,
  weatherPanelAlertsForRegion,
} from '../map/map.js';

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

  // Aviation conditions: one New England-wide answer each, clipped per region
  // in the browser, so region changes only recount them.
  const airportWeather = startPoller({
    key: 'airport-weather',
    interval: CONFIG.AIRPORT_WEATHER_POLL_MS,
    enabled: capabilities.airportWeather,
    url: () => '/api/airport-weather',
    apply(collection) {
      if (collection) setAirportWeatherData(collection);
      onCounts({ 'airport-weather': airportWeatherCountForRegion() });
    },
  }, onCounts);

  const tfrs = startPoller({
    key: 'tfr',
    interval: CONFIG.TFR_POLL_MS,
    enabled: capabilities.tfrs,
    url: () => '/api/tfrs',
    apply(collection) {
      if (collection) setTfrData(collection);
      onCounts({ tfr: tfrCountForRegion() });
    },
  }, onCounts);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    weather.refresh();
    airports.refresh();
    airportWeather.refresh();
    tfrs.refresh();
  });

  return {
    setRegion(nextRegion) {
      region = nextRegion;
      // The gateway filters weather by state, so a region change refetches;
      // airport status is region-independent and only needs a recount.
      weather.refresh();
      airports.refreshCount();
      airportWeather.refreshCount();
      tfrs.refreshCount();
    },
  };
}
