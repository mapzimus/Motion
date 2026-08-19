// New England shared bikes and scooters via public GBFS discovery feeds.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';

const feedCache = new Map();
const stationCache = new Map();
const typeCache = new Map();

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).hostname}`);
  return response.json();
}

function dataOf(json) {
  return json?.data?.en ?? json?.data ?? {};
}

async function feedsFor(system) {
  if (feedCache.has(system.id)) return feedCache.get(system.id);
  const discovery = await getJson(system.discoveryUrl);
  const feeds = Object.fromEntries(
    (dataOf(discovery).feeds ?? []).map((feed) => [feed.name, feed.url]),
  );
  feedCache.set(system.id, feeds);
  return feeds;
}

async function vehicleTypes(system, feeds) {
  if (!feeds.vehicle_types) return new Map();
  if (typeCache.has(system.id)) return typeCache.get(system.id);
  const json = await getJson(feeds.vehicle_types);
  const types = new Map(
    (dataOf(json).vehicle_types ?? []).map((type) => [type.vehicle_type_id, type]),
  );
  typeCache.set(system.id, types);
  return types;
}

function reportedAt(json, fallback = Date.now()) {
  const value = Number(json?.last_updated);
  return Number.isFinite(value) && value > 1e9
    ? new Date(value * 1000).toISOString()
    : new Date(fallback).toISOString();
}

async function stationItems(system, feeds) {
  if (!feeds.station_information || !feeds.station_status) return [];
  let information = stationCache.get(system.id);
  if (!information) {
    const json = await getJson(feeds.station_information);
    information = new Map(
      (dataOf(json).stations ?? []).map((station) => [station.station_id, station]),
    );
    stationCache.set(system.id, information);
  }
  const statusJson = await getJson(feeds.station_status);
  const fallbackTime = Date.parse(reportedAt(statusJson));
  return (dataOf(statusJson).stations ?? []).flatMap((station) => {
    const info = information.get(station.station_id);
    if (!info || station.is_installed === false || station.is_renting === false) return [];
    const bikes = station.num_bikes_available ?? 0;
    const ebikes = station.num_ebikes_available ?? 0;
    const docks = station.num_docks_available ?? 0;
    const timestamp = Number(station.last_reported) > 1e9
      ? new Date(Number(station.last_reported) * 1000).toISOString()
      : new Date(fallbackTime).toISOString();
    return [{
      id: `${system.id}-station-${station.station_id}`,
      lng: Number(info.lon),
      lat: Number(info.lat),
      props: {
        group: 'bike',
        markerKind: 'dock',
        color: bikes === 0
          ? CONFIG.BIKE_EMPTY_COLOR
          : bikes <= 2
            ? CONFIG.BIKE_LOW_COLOR
            : system.color,
        bearing: 0,
        hasBearing: false,
        stale: bikes === 0,
        title: system.name,
        dest: info.name,
        status: `${bikes} bike${bikes === 1 ? '' : 's'}${ebikes ? ` (${ebikes} electric)` : ''} · ${docks} dock${docks === 1 ? '' : 's'} open`,
        meta: Number.isFinite(Number(info.capacity)) ? `capacity ${info.capacity}` : 'GBFS station',
        updatedAt: timestamp,
      },
    }];
  });
}

function friendlyVehicle(type) {
  if (type?.form_factor === 'scooter') return 'electric scooter';
  if (type?.propulsion_type === 'human') return 'bike';
  return 'electric bike';
}

async function freeVehicleItems(system, feeds) {
  if (!feeds.free_bike_status || system.stationOnly) return [];
  const [statusJson, types] = await Promise.all([
    getJson(feeds.free_bike_status),
    vehicleTypes(system, feeds),
  ]);
  const fallbackTimestamp = reportedAt(statusJson);
  const vehicles = dataOf(statusJson).bikes ?? dataOf(statusJson).vehicles ?? [];
  return vehicles.flatMap((vehicle) => {
    if (vehicle.is_disabled || vehicle.is_reserved) return [];
    const lat = Number(vehicle.lat);
    const lng = Number(vehicle.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const type = types.get(vehicle.vehicle_type_id);
    const kind = type?.form_factor === 'scooter' ? 'scooter' : 'bicycle';
    const rangeMiles = Number.isFinite(Number(vehicle.current_range_meters))
      ? Math.round(Number(vehicle.current_range_meters) / 1609.344)
      : null;
    const battery = Number.isFinite(Number(vehicle.current_fuel_percent))
      ? `${Math.round(Number(vehicle.current_fuel_percent) * 100)}% battery`
      : '';
    const timestamp = Number(vehicle.last_reported) > 1e9
      ? new Date(Number(vehicle.last_reported) * 1000).toISOString()
      : fallbackTimestamp;
    return [{
      id: `${system.id}-vehicle-${vehicle.bike_id ?? vehicle.vehicle_id}`,
      lng,
      lat,
      props: {
        group: 'bike',
        markerKind: kind,
        color: system.color ?? CONFIG.BIKE_FREE_COLOR,
        bearing: 0,
        hasBearing: false,
        stale: false,
        title: system.name,
        dest: friendlyVehicle(type),
        status: [battery, rangeMiles !== null ? `about ${rangeMiles} mi range` : ''].filter(Boolean).join(' · ') || 'Available to rent',
        meta: 'free-floating GBFS vehicle',
        updatedAt: timestamp,
      },
    }];
  });
}

async function systemItems(system) {
  const feeds = await feedsFor(system);
  const [stations, vehicles] = await Promise.all([
    stationItems(system, feeds),
    freeVehicleItems(system, feeds),
  ]);
  return [...stations, ...vehicles];
}

export function startSharedMobility(onCounts) {
  const fleet = createFleet('bike');

  const poll = async () => {
    if (document.hidden) return;
    const settled = await Promise.allSettled(CONFIG.SHARED_MOBILITY_SYSTEMS.map(systemItems));
    const items = settled.flatMap((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      console.warn(
        `${CONFIG.SHARED_MOBILITY_SYSTEMS[index].name} GBFS unavailable:`,
        result.reason?.message ?? result.reason,
      );
      return [];
    });
    const visible = fleet.update(items);
    onCounts({ bike: visible.length });
  };

  poll();
  setInterval(poll, CONFIG.BIKE_POLL_MS);
}
