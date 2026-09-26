// Live "next arrivals" for MBTA stops. A stop popup opens with its reference
// info at once; this module then fetches MBTA V3 predictions for that GTFS
// stop id, renders them beneath the reference block, and keeps refreshing
// while the popup stays open. Every other agency in the snapshot publishes
// schedules only, so their popups get a one-line note instead of a fake ETA.

import { mbta } from './api.js';

const REFRESH_MS = 15_000;
const MAX_PER_ROUTE = 3;
const MBTA_PROVIDER = 'MBTA official static GTFS';

const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// The route snapshot tags every MBTA stop with its provider string and the
// GTFS stop_id (`stationCode`: "70061", "place-alfcl", "Boat-Aquarium").
export function isMbtaStop(properties) {
  return properties?.kind === 'regional-station'
    && properties.provider === MBTA_PROVIDER
    && Boolean(properties.stationCode);
}

// Non-MBTA stops carry "<Agency> stop · <code>" in their status line.
export function agencyForStop(properties) {
  const match = /^(.+?) (?:stop|station|landing) · /.exec(properties?.status ?? '');
  return match ? match[1] : 'this operator';
}

function minutesUntil(iso, now) {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  return (timestamp - now) / 60_000;
}

function etaLabel(prediction, now) {
  const minutes = minutesUntil(prediction.arrival_time ?? prediction.departure_time, now);
  if (minutes === null) return prediction.status || '';
  if (minutes < 1) {
    if (prediction.status) return prediction.status; // MBTA sends "Boarding" / "Arriving" etc.
    return prediction.arrival_time ? 'Arriving' : 'Boarding';
  }
  return `${Math.round(minutes)} min`;
}

// Flatten JSON:API into per-route lists, keeping the soonest MAX_PER_ROUTE.
export function groupPredictions(json, now = Date.now()) {
  const routes = new Map();
  const trips = new Map();
  for (const item of json.included ?? []) {
    if (item.type === 'route') routes.set(item.id, item.attributes ?? {});
    if (item.type === 'trip') trips.set(item.id, item.attributes ?? {});
  }
  const byRoute = new Map();
  for (const item of json.data ?? []) {
    const attributes = item.attributes ?? {};
    const routeId = item.relationships?.route?.data?.id;
    if (!routeId) continue;
    const when = attributes.arrival_time ?? attributes.departure_time;
    const minutes = minutesUntil(when, now);
    if (minutes === null && !attributes.status) continue;
    if (minutes !== null && minutes < -0.5) continue; // already gone
    if (attributes.schedule_relationship === 'CANCELLED'
      || attributes.schedule_relationship === 'SKIPPED') continue;
    const trip = trips.get(item.relationships?.trip?.data?.id) ?? {};
    if (!byRoute.has(routeId)) {
      const route = routes.get(routeId) ?? {};
      byRoute.set(routeId, {
        id: routeId,
        name: route.short_name || route.long_name || routeId,
        color: route.color ? `#${route.color}` : '#8a939c',
        textColor: route.text_color ? `#${route.text_color}` : '#ffffff',
        arrivals: [],
      });
    }
    byRoute.get(routeId).arrivals.push({
      sortKey: minutes ?? -1,
      eta: etaLabel(attributes, now),
      headsign: trip.headsign || '',
    });
  }
  const groups = [...byRoute.values()];
  for (const group of groups) {
    group.arrivals.sort((a, b) => a.sortKey - b.sortKey);
    group.arrivals = group.arrivals.slice(0, MAX_PER_ROUTE);
  }
  groups.sort((a, b) => a.arrivals[0].sortKey - b.arrivals[0].sortKey);
  return groups;
}

function arrivalsHtml(groups) {
  if (!groups.length) {
    return '<div class="popup-status">No upcoming arrivals predicted right now.</div>';
  }
  return groups.map((group) => `
    <div class="popup-arrival-route">
      <span class="popup-route-chip" style="background:${esc(group.color)};color:${esc(group.textColor)}">${esc(group.name)}</span>
      <div class="popup-arrival-list">
        ${group.arrivals.map((arrival) => `
          <div class="popup-arrival">
            <span class="popup-arrival-eta">${esc(arrival.eta)}</span>
            ${arrival.headsign ? `<span class="popup-arrival-headsign">${esc(arrival.headsign)}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>`).join('');
}

function blockHtml(body, note = '') {
  return `
    <div class="popup-predictions">
      <div class="popup-predictions-head">
        <span class="popup-data-status live">live</span>
        <span>Next arrivals</span>
      </div>
      ${body}
      ${note ? `<div class="popup-meta">${esc(note)}</div>` : ''}
    </div>`;
}

export function noPredictionsHtml(properties) {
  return `<div class="popup-route-note">No live predictions published by ${esc(agencyForStop(properties))}</div>`;
}

export async function fetchStopPredictions(stopId) {
  const json = await mbta('/predictions', {
    'filter[stop]': stopId,
    sort: 'arrival_time',
    include: 'route,trip',
    'page[limit]': '12',
    'fields[prediction]': 'arrival_time,departure_time,status,schedule_relationship',
    'fields[route]': 'short_name,long_name,color,text_color',
    'fields[trip]': 'headsign',
  });
  return groupPredictions(json);
}

// `render(extraHtml)` re-draws the popup with the given block appended to the
// reference info. Polling stops as soon as the popup closes.
export function attachStopPredictions(popup, properties, render) {
  if (!isMbtaStop(properties)) {
    render(noPredictionsHtml(properties));
    return;
  }
  render(blockHtml('<div class="popup-status">Loading predictions…</div>'));
  let timer = null;
  let closed = false;
  const stop = () => {
    closed = true;
    clearTimeout(timer);
  };
  popup.once('close', stop);

  async function tick() {
    if (closed) return;
    if (document.hidden) {
      timer = setTimeout(tick, REFRESH_MS);
      return;
    }
    try {
      const groups = await fetchStopPredictions(properties.stationCode);
      if (closed || !popup.isOpen()) return stop();
      const stamp = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      render(blockHtml(arrivalsHtml(groups), `MBTA V3 predictions · refreshed ${stamp}`));
    } catch (error) {
      if (closed || !popup.isOpen()) return stop();
      const reason = error.status === 429 ? 'rate limited — retrying' : 'retrying';
      render(blockHtml(`<div class="popup-status">Predictions unavailable (${esc(reason)})</div>`));
    }
    timer = setTimeout(tick, REFRESH_MS);
  }
  tick();
}
