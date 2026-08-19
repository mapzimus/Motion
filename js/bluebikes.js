// Bluebikes station layer via the public GBFS feed (keyless, CORS-open).
// Stations don't move, but their fill level is live — dots read at a glance:
// blue = stocked, amber = 1-2 bikes left, dim gray = empty.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';

let infoCache = null; // station_id -> {name, lat, lon, capacity}; effectively static

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bluebikes ${res.status}`);
  return res.json();
}

export function startBluebikes(onCounts) {
  const fleet = createFleet('bike');

  const poll = async () => {
    if (document.hidden) return;
    try {
      if (!infoCache) {
        const info = await getJson(CONFIG.BIKE_INFO_URL);
        infoCache = new Map(info.data.stations.map((s) => [s.station_id, s]));
      }
      const status = await getJson(CONFIG.BIKE_STATUS_URL);

      const items = [];
      for (const s of status.data.stations) {
        const info = infoCache.get(s.station_id);
        if (!info || !s.is_installed) continue; // winterized/decommissioned
        const bikes = s.num_bikes_available ?? 0;
        const ebikes = s.num_ebikes_available ?? 0;
        const docks = s.num_docks_available ?? 0;
        // Dead stations report bogus epochs like 86400 — treat as "now".
        const reported =
          s.last_reported > 1e9 ? s.last_reported : Math.floor(Date.now() / 1000);
        items.push({
          id: s.station_id,
          lng: info.lon,
          lat: info.lat,
          props: {
            group: 'bike',
            color:
              bikes === 0
                ? CONFIG.BIKE_EMPTY_COLOR
                : bikes <= 2
                  ? CONFIG.BIKE_LOW_COLOR
                  : CONFIG.BIKE_COLOR,
            bearing: 0,
            hasBearing: false,
            stale: bikes === 0, // empty stations render dimmed
            title: 'Bluebikes',
            dest: info.name,
            status: `${bikes} bike${bikes === 1 ? '' : 's'}${ebikes ? ` (${ebikes} electric)` : ''} · ${docks} dock${docks === 1 ? '' : 's'} open`,
            meta: `capacity ${info.capacity}`,
            updatedAt: new Date(reported * 1000).toISOString(),
          },
        });
      }
      const visible = fleet.update(items);
      onCounts({ bike: visible.length });
    } catch (err) {
      console.warn('Bluebikes unavailable:', err.message);
    }
  };

  poll();
  setInterval(poll, CONFIG.BIKE_POLL_MS);
}
