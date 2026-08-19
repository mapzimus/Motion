// Amtrak poller via the community Amtraker API (CORS-open, keyless).
// The feed returns every train in the US (~1 MB), so we poll gently and keep
// only trains inside the map region.

import { CONFIG } from './config.js';
import { createFleet } from './fleet.js';
import { ageAmtrakItems, normalizeAmtrakTrain } from './amtrak-normalize.js';

export function startAmtrak(onCounts) {
  const fleet = createFleet('amtrak');
  const box = CONFIG.AMTRAK_BBOX;
  let latestItems = [];

  const poll = async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(CONFIG.AMTRAK_URL);
      if (!res.ok) throw new Error(`Amtraker ${res.status}`);
      const json = await res.json();

      const now = Date.now();
      const items = Object.values(json)
        .flat()
        .map((train) => normalizeAmtrakTrain(train, {
          box,
          color: CONFIG.AMTRAK_COLOR,
          now,
          staleAfterMs: CONFIG.AMTRAK_STALE_MS,
        }))
        .filter(Boolean);

      latestItems = items;
      const visible = fleet.update(items);
      onCounts({ amtrak: visible.length });
    } catch (err) {
      console.warn('Amtrak feed unavailable:', err.message);
      if (latestItems.length) {
        latestItems = ageAmtrakItems(latestItems, Date.now(), CONFIG.AMTRAK_STALE_MS);
        const visible = fleet.update(latestItems);
        onCounts({ amtrak: visible.length });
      }
    }
  };

  poll();
  setInterval(poll, CONFIG.AMTRAK_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
}
