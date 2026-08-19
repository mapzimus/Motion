// Live New England aircraft via the Motion gateway and ADSB.lol.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';

const KNOTS_TO_MPH = 1.15078;

export function startPlanes(onCounts, initialRegion, enabled = true) {
  if (!CONFIG.AIRCRAFT_GATEWAY_BASE || !enabled) {
    onCounts({ plane: null });
    return { setRegion() {} };
  }

  const fleet = createFleet('plane');
  let region = initialRegion;
  let timer = null;

  const poll = async () => {
    clearTimeout(timer);
    if (document.hidden) {
      timer = setTimeout(poll, CONFIG.PLANE_POLL_MS);
      return;
    }
    try {
      const res = await fetch(
        `${CONFIG.AIRCRAFT_GATEWAY_BASE}/api/planes?region=${encodeURIComponent(region)}`,
      );
      if (!res.ok) throw new Error(`Motion aircraft gateway ${res.status}`);
      const json = await res.json();
      const aircraft = (json.aircraft ?? []).filter(
        (a) => Number.isFinite(a.lat) && Number.isFinite(a.lng),
      );

      const items = aircraft.map((a) => {
        return {
          id: `plane-${a.id}`,
          lng: a.lng,
          lat: a.lat,
          props: {
            group: 'plane',
            color: CONFIG.PLANE_COLOR,
            bearing: a.bearing ?? 0,
            hasBearing: Number.isFinite(a.bearing),
            stale: a.onGround, // taxiing aircraft render dimmed
            title: a.callsign || a.id.toUpperCase(),
            dest: a.aircraftType ?? '',
            status: a.onGround
              ? 'On the ground'
              : [
                  Number.isFinite(a.altitudeFeet) ? `${a.altitudeFeet.toLocaleString()} ft` : '',
                  Number.isFinite(a.groundSpeedKnots) ? `${Math.round(a.groundSpeedKnots * KNOTS_TO_MPH)} mph` : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
            meta: `icao ${a.id}`,
            updatedAt: a.updatedAt,
          },
        };
      });

      const visible = fleet.update(items);
      onCounts({ plane: visible.length });
    } catch (err) {
      console.warn('Plane feed unavailable:', err.message);
    }
    timer = setTimeout(poll, CONFIG.PLANE_POLL_MS);
  };

  poll();
  return {
    setRegion(nextRegion) {
      region = nextRegion;
      clearTimeout(timer);
      poll();
    },
  };
}
