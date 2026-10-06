// Generic animated vehicle fleet. Each data source (MBTA, Amtrak, planes,
// AIS vessels) owns one fleet; the fleet owns positions on the map and glides
// markers between updates. Display strings live in feature props so the map's
// popup code is source-agnostic: { id, color, bearing, hasBearing, stale,
// group, title, dest, status, meta, updatedAt, ageLabel? }. `ageLabel` prefixes
// the age shown in popups and trip cards (vessels: "Last heard").
//
// Items may also carry a `detail` object beside `props` (trip id, train
// number, upcoming stations). It is kept out of the GeoJSON so it is not
// serialized to the map worker on every animation frame.

import { CONFIG } from './config.js';
import { setFleetData } from '../map/map.js';
import { filterItems } from './regions.js';

const registry = new Map(); // fleetId -> fleet API
export const getFleet = (fleetId) => registry.get(fleetId);
export const allFleets = () => [...registry.entries()];

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const linear = (t) => t;
// Long glides (a followed vehicle stretched across a whole poll interval)
// read best at constant speed; easeOutCubic over 9 s sprints then crawls.
const LONG_GLIDE_MS = 2000;

export function createFleet(fleetId) {
  const latest = new Map(); // id -> item { id, lng, lat, props, detail? }
  const displayed = new Map(); // id -> [lng, lat] currently drawn
  const active = new Map(); // id -> { from, to, t0, dur, ease }
  const glideOverrides = new Map(); // id -> ms
  const frameListeners = new Set();
  const updateListeners = new Set();
  let animFrame = null;

  function update(items) {
    latest.clear();
    const now = performance.now();
    for (const item of items) {
      item.props.id = item.id;
      latest.set(item.id, item);
      const to = [item.lng, item.lat];
      const from = displayed.get(item.id);
      if (!from) {
        displayed.set(item.id, to); // new arrival: appear in place
        continue;
      }
      const running = active.get(item.id);
      const target = running ? running.to : from;
      if (target[0] === to[0] && target[1] === to[1]) continue; // unchanged report
      const dur = glideOverrides.get(item.id) ?? CONFIG.ANIMATE_MS;
      active.set(item.id, {
        from: [...from],
        to,
        t0: now,
        dur,
        ease: dur > LONG_GLIDE_MS ? linear : easeOutCubic,
      });
    }
    for (const id of [...displayed.keys()]) {
      if (!latest.has(id)) {
        displayed.delete(id);
        active.delete(id);
      }
    }
    if (active.size) startLoop();
    else render();
    updateListeners.forEach((fn) => fn());
    // Vessels are counted against the coastal (marine) boundary, matching
    // what map.js draws for them.
    return filterItems(items, undefined, { marine: fleetId === 'vessel' });
  }

  function startLoop() {
    if (animFrame !== null) return; // one loop per fleet, shared by all tweens
    const step = (now) => {
      for (const [id, tween] of active) {
        const t = Math.min((now - tween.t0) / tween.dur, 1);
        const k = tween.ease(t);
        displayed.set(id, [
          tween.from[0] + (tween.to[0] - tween.from[0]) * k,
          tween.from[1] + (tween.to[1] - tween.from[1]) * k,
        ]);
        if (t >= 1) active.delete(id);
      }
      render();
      animFrame = active.size ? requestAnimationFrame(step) : null;
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
    frameListeners.forEach((fn) => fn());
  }

  const subscribe = (set) => (fn) => {
    set.add(fn);
    return () => set.delete(fn);
  };

  const api = {
    id: fleetId,
    update,
    has: (id) => latest.has(id),
    getItem: (id) => latest.get(id),
    getDisplayed: (id) => displayed.get(id),
    items: () => latest.values(),
    onFrame: subscribe(frameListeners),
    onUpdate: subscribe(updateListeners),
    setGlide(id, ms) {
      if (ms) glideOverrides.set(id, ms);
      else glideOverrides.delete(id);
    },
  };
  registry.set(fleetId, api);
  return api;
}
