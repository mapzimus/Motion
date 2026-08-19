// Amtrak poller via the community Amtraker API (CORS-open, keyless).
// The feed returns every train in the US (~1 MB), so we poll gently and keep
// only trains inside the map region.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';

// Amtraker reports heading as a compass point, not degrees.
const COMPASS = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

export function startAmtrak(onCounts) {
  const fleet = createFleet('amtrak');
  const box = CONFIG.AMTRAK_BBOX;

  const poll = async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(CONFIG.AMTRAK_URL);
      if (!res.ok) throw new Error(`Amtraker ${res.status}`);
      const json = await res.json();

      const trains = Object.values(json)
        .flat()
        .filter(
          (t) =>
            t.lat > box.latMin && t.lat < box.latMax &&
            t.lon > box.lonMin && t.lon < box.lonMax,
        );

      const items = trains.map((t) => {
        const heading = COMPASS[t.heading];
        const nextStation = (t.stations ?? []).find((s) => s.status === 'Enroute');
        const finalStation = (t.stations ?? []).at(-1);
        return {
          id: `amtrak-${t.trainID ?? t.trainNum}`,
          lng: t.lon,
          lat: t.lat,
          props: {
            group: 'amtrak',
            color: CONFIG.AMTRAK_COLOR,
            bearing: heading ?? 0,
            hasBearing: heading !== undefined,
            stale: false,
            title: `Amtrak ${t.routeName ?? ''}`.trim(),
            dest: finalStation?.name ? `to ${finalStation.name}` : '',
            status: nextStation?.name
              ? `Next stop ${nextStation.name}`
              : (t.trainState ?? ''),
            meta: [
              `train ${t.trainNum}`,
              Number.isFinite(t.velocity) ? `${Math.round(t.velocity)} mph` : '',
            ]
              .filter(Boolean)
              .join(' · '),
            updatedAt: t.updatedAt ?? new Date().toISOString(),
          },
        };
      });

      const visible = fleet.update(items);
      onCounts({ amtrak: visible.length });
    } catch (err) {
      console.warn('Amtrak feed unavailable:', err.message);
    }
  };

  poll();
  setInterval(poll, CONFIG.AMTRAK_POLL_MS);
}
