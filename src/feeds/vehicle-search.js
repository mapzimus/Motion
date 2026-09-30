// Live-vehicle matching for the sidebar search. Pure: it reads whatever the
// fleets hold right now and returns search entries. No index is kept; a scan
// of ~2,000 live items per keystroke is well under a millisecond.
//
// What riders type, and what it matches:
//   "5747"          commuter-rail / Amtrak / Metro-North train number (95)
//   "1864"          MBTA car label, or a regional bus's vehicle number (90)
//   "JBU1123"       aircraft callsign exact (95), "JBU" prefix (70)
//   "39", "route 39" MBTA bus short name exact (75)
//   "franklin line" route name (65 prefix / 55 contains)
//   "queen"         free text in title or destination (40)

import { allFleets } from './fleet.js';
import { getRecent } from '../follow/follow.js';

const SKIP_FLEETS = new Set(['bike']); // ~600 docks would drown every query
const MAX_VEHICLES = 5;
const FILLER = /\b(line|route|rt|train|trains|bus|buses|the|flight|no|number|car|vehicle)\b/g;

const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function numberOf(item) {
  return String(item.detail?.trainNumber ?? '').toLowerCase();
}

function labelsOf(item) {
  return String(item.detail?.label ?? '')
    .toLowerCase()
    .split(/[-,\s]+/)
    .filter(Boolean);
}

function scoreItem(fleetId, item, q, core) {
  const p = item.props;
  if (normalize(item.id) === q || normalize(`${fleetId} ${item.id}`) === q) return 100;
  let best = 0;
  const token = core.replace(/\s+/g, '');
  if (token && token.length <= 8) {
    if (numberOf(item) === token) best = Math.max(best, 95);
    if (labelsOf(item).includes(token)) best = Math.max(best, 90);
    const callsign = String(p.callsign ?? '').toLowerCase();
    if (callsign) {
      if (callsign === token) best = Math.max(best, 95);
      else if (token.length >= 3 && callsign.startsWith(token)) best = Math.max(best, 70);
    }
  }
  if (core.length >= 1) {
    const shortName = normalize(item.detail?.routeShortName);
    if (shortName && shortName === core) best = Math.max(best, 75);
  }
  if (core.length >= 3) {
    const routeName = normalize(item.detail?.routeName || p.title);
    if (routeName.startsWith(core)) best = Math.max(best, 65);
    else if (routeName.includes(core)) best = Math.max(best, 55);
  }
  if (q.length >= 3 && best < 40) {
    if (normalize(p.title).includes(q) || normalize(p.dest).includes(q)) best = 40;
  }
  return best;
}

function entryFor(fleetId, item, score) {
  const p = item.props;
  const number = item.detail?.trainNumber;
  const label = item.detail?.label;
  let name = p.title;
  if (number) name = `Train ${number} · ${p.title}`;
  else if (fleetId === 'regional' && label) name = `${p.title} · vehicle ${label}`;
  else if (fleetId === 'mbta' && p.group !== 'commuter' && label) name = `${p.title} · car ${label}`;
  return {
    type: 'vehicle',
    name,
    sub: [p.dest, p.status].filter(Boolean).join(' · '),
    color: p.color,
    fleetId,
    id: item.id,
    stale: Boolean(p.stale),
    score,
  };
}

// Returns [score, entry] pairs so the caller can merge with place results.
export function searchVehicles(query) {
  const q = normalize(query);
  if (!q) return [];
  const core = q.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  const scored = [];
  for (const [fleetId, fleet] of allFleets()) {
    if (SKIP_FLEETS.has(fleetId)) continue;
    for (const item of fleet.items()) {
      const score = scoreItem(fleetId, item, q, core);
      if (score) scored.push([score, entryFor(fleetId, item, score)]);
    }
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].stale - b[1].stale || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, MAX_VEHICLES);
}

// Recently followed vehicles that are still in a live feed, for an empty box.
export function recentVehicles() {
  const fleets = new Map(allFleets());
  return getRecent()
    .map((recent) => {
      const item = fleets.get(recent.fleetId)?.getItem(recent.id);
      if (!item) return null;
      const entry = entryFor(recent.fleetId, item, 0);
      entry.sub = `Recently followed · ${entry.sub}`;
      return entry;
    })
    .filter(Boolean);
}
