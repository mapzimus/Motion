// Generic animated vehicle fleet. Each data source (MBTA, Amtrak, planes,
// AIS vessels) owns one fleet; the fleet owns positions on the map and glides
// markers between updates. Display strings live in feature props so the map's
// popup code is source-agnostic: { color, bearing, hasBearing, stale, group,
// title, dest, status, meta, updatedAt }.

import { CONFIG } from './config.js';
import { setFleetData } from './map.js';
import { filterItems } from './regions.js';

export function createFleet(fleetId) {
  const latest = new Map(); // id -> { lng, lat, props }
  const displayed = new Map(); // id -> [lng, lat] currently drawn
  let animFrame = null;

  function update(items) {
    latest.clear();
    const moves = [];
    for (const item of items) {
      latest.set(item.id, item);
      const from = displayed.get(item.id);
      const to = [item.lng, item.lat];
      if (!from) {
        displayed.set(item.id, to); // new arrival: appear in place
      } else if (from[0] !== to[0] || from[1] !== to[1]) {
        moves.push({ id: item.id, from: [...from], to });
      }
    }
    for (const id of [...displayed.keys()]) {
      if (!latest.has(id)) displayed.delete(id);
    }
    if (moves.length) animate(moves);
    else render();
    return filterItems(items);
  }

  function animate(moves) {
    cancelAnimationFrame(animFrame);
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min((now - t0) / CONFIG.ANIMATE_MS, 1);
      const ease = 1 - (1 - t) ** 3; // easeOutCubic
      for (const m of moves) {
        if (!displayed.has(m.id)) continue;
        displayed.set(m.id, [
          m.from[0] + (m.to[0] - m.from[0]) * ease,
          m.from[1] + (m.to[1] - m.from[1]) * ease,
        ]);
      }
      render();
      animFrame = t < 1 ? requestAnimationFrame(step) : null;
    };
    animFrame = requestAnimationFrame(step);
  }

  function render() {
    const features = [];
    for (const [id, item] of latest) {
      const pos = displayed.get(id);
      if (!pos) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pos },
        properties: item.props,
      });
    }
    setFleetData(fleetId, { type: 'FeatureCollection', features });
  }

  return { update };
}
