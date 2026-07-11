// Live aircraft around Logan via the airplanes.live community ADS-B API
// (CORS-open, keyless, ~1 req/s courtesy cap — we poll every 45 s).

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';

const KNOTS_TO_MPH = 1.15078;

export function startPlanes(onCounts) {
  const fleet = createFleet('plane');

  const poll = async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(CONFIG.PLANES_URL);
      if (!res.ok) throw new Error(`airplanes.live ${res.status}`);
      const json = await res.json();
      const aircraft = (json.ac ?? []).filter(
        (a) => Number.isFinite(a.lat) && Number.isFinite(a.lon),
      );

      const items = aircraft.map((a) => {
        const onGround = a.alt_baro === 'ground';
        const seenSec = Number.isFinite(a.seen) ? a.seen : 0;
        return {
          id: `plane-${a.hex}`,
          lng: a.lon,
          lat: a.lat,
          props: {
            group: 'plane',
            color: CONFIG.PLANE_COLOR,
            bearing: a.track ?? 0,
            hasBearing: Number.isFinite(a.track),
            stale: onGround, // taxiing aircraft render dimmed
            title: a.flight?.trim() || a.hex.toUpperCase(),
            dest: a.t ?? '',
            status: onGround
              ? 'On the ground'
              : [
                  Number.isFinite(a.alt_baro) ? `${a.alt_baro.toLocaleString()} ft` : '',
                  Number.isFinite(a.gs) ? `${Math.round(a.gs * KNOTS_TO_MPH)} mph` : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
            meta: `icao ${a.hex}`,
            updatedAt: new Date(Date.now() - seenSec * 1000).toISOString(),
          },
        };
      });

      fleet.update(items);
      onCounts({ plane: items.length });
    } catch (err) {
      console.warn('Plane feed unavailable:', err.message);
    }
  };

  poll();
  setInterval(poll, CONFIG.PLANE_POLL_MS);
}
