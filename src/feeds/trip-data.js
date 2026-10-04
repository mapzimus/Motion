// Trip card data. Turns whichever vehicle is followed into one card shape,
// and fetches the extra detail that is worth a request: MBTA trip predictions
// (next stops + delay) and a plane's scheduled route. DOM-free.
//
// Card shape:
//   { color, title, badge, headsign, status, stops: [{ name, eta, delay, late }] | null,
//     stopsNote, meta, dataStatus, provider, sourceUrl, updatedAt }

import { CONFIG } from './config.js';
import { fetchTripPredictions, parseTripPredictions } from './predictions.js';
import { lookupFlightRoute } from './flight-routes.js';

const FLEET_LABEL = {
  mbta: 'MBTA vehicle',
  amtrak: 'Amtrak train',
  mnr: 'Metro-North train',
  regional: 'bus',
  plane: 'aircraft',
  vessel: 'vessel',
  bike: 'bike share point',
};
export const fleetLabel = (fleetId) => FLEET_LABEL[fleetId] ?? 'vehicle';

const clockTime = (iso) => {
  const time = Date.parse(iso);
  return Number.isFinite(time)
    ? new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
};

const isLate = (text) => /late|delay/i.test(text ?? '');

// ---- extras watcher -------------------------------------------------------------
// One per card. `set(fleetId, item)` is called on every feed update; it only
// starts a new fetch when the trip (or callsign) actually changes.

export function createTripWatcher(onChange) {
  let key = null;
  let timer = null;
  let controller = null;
  let failures = 0;
  let extras = null; // { kind: 'predictions', json } | { kind: 'route', route } | { kind: 'error' }

  const publish = (next) => {
    extras = next;
    onChange(extras);
  };

  function stop() {
    clearTimeout(timer);
    controller?.abort();
    timer = null;
    controller = null;
  }

  async function pollPredictions(tripId) {
    if (key !== `trip:${tripId}`) return;
    if (document.hidden) {
      timer = setTimeout(() => pollPredictions(tripId), CONFIG.TRIP_PREDICTION_POLL_MS);
      return;
    }
    controller = new AbortController();
    try {
      const json = await fetchTripPredictions(tripId, { signal: controller.signal });
      if (key !== `trip:${tripId}`) return;
      failures = 0;
      publish({ kind: 'predictions', json, at: Date.now() });
    } catch (error) {
      if (error.name === 'AbortError' || key !== `trip:${tripId}`) return;
      failures += 1;
      if (!extras || extras.kind !== 'predictions') {
        publish({ kind: 'error', rateLimited: error.status === 429 });
      }
    }
    const wait = failures
      ? Math.min(CONFIG.TRIP_PREDICTION_POLL_MS * 2 ** failures, 60_000)
      : CONFIG.TRIP_PREDICTION_POLL_MS;
    timer = setTimeout(() => pollPredictions(tripId), wait);
  }

  function set(fleetId, item) {
    let next = null;
    if (fleetId === 'mbta' && item?.detail?.tripId) next = `trip:${item.detail.tripId}`;
    else if (fleetId === 'plane' && item?.props.callsign) next = `route:${item.props.callsign}`;
    if (next === key) return;
    stop();
    key = next;
    failures = 0;
    extras = null;
    onChange(null);
    if (!next) return;
    if (next.startsWith('trip:')) {
      pollPredictions(item.detail.tripId);
    } else {
      const callsign = item.props.callsign;
      lookupFlightRoute(callsign)
        .then((route) => { if (key === `route:${callsign}`) publish({ kind: 'route', route }); })
        .catch(() => { if (key === `route:${callsign}`) publish({ kind: 'route', route: null }); });
    }
  }

  return {
    set,
    stop() {
      stop();
      key = null;
      extras = null;
    },
  };
}

// ---- card model -------------------------------------------------------------------

function mbtaCard(item, extras) {
  const d = item.detail ?? {};
  const p = item.props;
  const card = {
    title: p.title,
    badge: d.trainNumber ? `Train ${d.trainNumber}` : (p.group === 'bus' ? '' : (d.label ? `Car ${d.label}` : '')),
    headsign: p.dest,
    status: p.status,
    stops: null,
    stopsNote: '',
    meta: [d.trainNumber && d.label ? `car ${d.label}` : '', p.meta.split(' · ').filter((part) => /crowding/i.test(part))[0] ?? '']
      .filter(Boolean).join(' · '),
  };
  if (!d.tripId) {
    card.stopsNote = 'No trip assigned to this vehicle right now.';
  } else if (extras?.kind === 'predictions') {
    const parsed = parseTripPredictions(extras.json, d.stopSequence, Date.now());
    if (parsed.headsign) card.headsign = `to ${parsed.headsign}`;
    if (parsed.trainName && !d.trainNumber && p.group === 'commuter') card.badge = `Train ${parsed.trainName}`;
    card.stops = parsed.stops.map((stop) => ({
      name: stop.platform && p.group === 'commuter' ? `${stop.name} · track ${stop.platform}` : stop.name,
      eta: stop.eta,
      clock: clockTime(stop.time),
      delay: stop.delay,
      late: isLate(stop.delay),
    }));
    if (!card.stops.length) card.stopsNote = 'No upcoming stops predicted. The trip may be ending.';
  } else if (extras?.kind === 'error') {
    card.stopsNote = extras.rateLimited
      ? 'Next stops unavailable (MBTA rate limit). Retrying.'
      : 'Next stops unavailable right now. Retrying.';
  } else {
    card.stopsNote = 'Loading next stops…';
  }
  return card;
}

function amtrakCard(item) {
  const d = item.detail ?? {};
  const p = item.props;
  return {
    title: p.title,
    badge: d.trainNumber ? `Train ${d.trainNumber}` : '',
    headsign: p.dest,
    status: p.status,
    stops: (d.stations ?? []).map((station) => {
      const minutes = (Date.parse(station.eta) - Date.now()) / 60_000;
      return {
        name: station.name,
        eta: Number.isFinite(minutes) ? (minutes < 1 ? 'Due' : `${Math.round(minutes)} min`) : '',
        clock: clockTime(station.eta),
        delay: station.delay,
        late: isLate(station.delay),
      };
    }),
    stopsNote: d.stations?.length ? '' : 'No upcoming stations reported.',
    meta: p.meta.split(' · ').filter((part) => /mph/.test(part)).join(''),
  };
}

function mnrCard(item) {
  const d = item.detail ?? {};
  const p = item.props;
  return {
    title: p.title,
    badge: d.trainNumber ? `Train ${d.trainNumber}` : '',
    headsign: d.headsign ? `to ${d.headsign}` : '',
    status: p.status,
    stops: d.nextStop
      ? [{ name: d.nextStop, eta: d.nextMinutes ? `${d.nextMinutes} min` : 'Due', clock: '', delay: '', late: false }]
      : null,
    stopsNote: p.dataStatus === 'live'
      ? 'Metro-North position is the reported GPS fix of the train. The feed exposes the next stop only.'
      : 'Metro-North position is estimated between stations. The feed exposes the next stop only.',
    meta: '',
  };
}

function planeCard(item, extras) {
  const p = item.props;
  let headsign = p.dest;
  let stopsNote = '';
  if (!p.callsign) stopsNote = 'No callsign broadcast, so no scheduled route.';
  else if (!extras) stopsNote = 'Looking up scheduled route…';
  else if (extras.kind === 'route' && extras.route?.airports?.length) {
    const airports = extras.route.airports;
    headsign = airports.map((airport) => airport.iata || airport.icao).filter(Boolean).join(' → ');
    stopsNote = `${airports[0].name} → ${airports.at(-1).name} · best-effort scheduled route`;
  } else stopsNote = 'Scheduled route unavailable for this callsign.';
  return {
    title: p.title,
    badge: p.dest && p.dest !== p.title ? p.dest : '',
    headsign,
    status: p.status,
    stops: null,
    stopsNote,
    meta: p.meta,
  };
}

function genericCard(item) {
  const p = item.props;
  return {
    title: p.title,
    badge: item.detail?.label ? `Vehicle ${item.detail.label}` : '',
    headsign: item.detail?.label ? '' : p.dest,
    status: p.status,
    stops: null,
    stopsNote: '',
    meta: p.meta,
  };
}

export function tripCardData(fleetId, item, extras) {
  if (!item) return null;
  const builder = { mbta: mbtaCard, amtrak: amtrakCard, mnr: mnrCard, plane: planeCard }[fleetId] ?? genericCard;
  const card = builder(item, extras);
  const p = item.props;
  return {
    ...card,
    color: p.color,
    dataStatus: p.dataStatus ?? 'live',
    stale: Boolean(p.stale),
    provider: p.provider ?? '',
    sourceUrl: /^https:\/\//.test(p.sourceUrl ?? '') ? p.sourceUrl : '',
    updatedAt: p.updatedAt,
  };
}

