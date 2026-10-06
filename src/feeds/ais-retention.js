// How long the map keeps an AIS vessel. Mirrors the gateway hub
// (worker/src/ais-hub.ts): a vessel is dropped after AIS_PRUNE_MOVING_MS of
// listening without a report, AIS_PRUNE_MOORED_MS if it was moored, and always
// once its real age passes AIS_MAX_AGE_MS. Each vessel record carries `at`
// (real time last heard: dimming and "Last heard") and `quietSince` (when its
// listening silence began: pruning).

import { CONFIG } from './config.js';

export const isMoored = (sog) => Number.isFinite(sog) && sog >= 0 && sog < CONFIG.AIS_MOORED_SOG_KN;

// Unknown speed counts as moving.
export const pruneAfterMs = (sog) => (isMoored(sog) ? CONFIG.AIS_PRUNE_MOORED_MS : CONFIG.AIS_PRUNE_MOVING_MS);

export function shouldPruneVessel(vessel, now) {
  if (now - vessel.at > CONFIG.AIS_MAX_AGE_MS) return true;
  return now - (vessel.quietSince ?? vessel.at) > pruneAfterMs(vessel.sog);
}

export const isStaleVessel = (vessel, now) => now - vessel.at > CONFIG.AIS_STALE_MS;

// A snapshot vessel's silence starts `quietMs` (the gateway's listening time
// since it last heard the boat) before the snapshot arrived. That is shorter
// than its real age when nobody was listening, so a boat last heard hours ago,
// just before the gateway went idle, shows dimmed instead of being dropped.
// Older gateways send no quietMs: fall back to the real age.
export function snapshotQuietSince(heardAt, quietMs, receivedAt) {
  if (!Number.isFinite(quietMs) || quietMs < 0) return heardAt;
  return Math.max(heardAt, receivedAt - quietMs);
}
