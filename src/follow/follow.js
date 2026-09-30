// Follow one vehicle. Holds the selection (which vehicle, and whether the
// camera is locked to it), draws the highlight ring, keeps the map centered
// while locked, and lets go when the rider takes the camera back.
//
// Modes:
//   pending    waiting for a shared link's vehicle to show up in its feed
//   selected   ring + trip card, camera free (a plain map click lands here)
//   following  ring + trip card + camera lock (search pick, shared link, or
//              the card's Follow button)
// `lost` is a flag on top of selected/following: the feed stopped reporting
// the vehicle, and we wait a few poll intervals before giving up.
//
// DOM-free apart from the map: the trip card subscribes and renders.

import { CONFIG } from '../feeds/config.js';
import { fitPadding, map, onCameraTakeover, setSelectedFeature } from '../map/map.js';
import { getFleet } from '../feeds/fleet.js';
import { schedulePermalinkUpdate } from '../feeds/permalink.js';

const RECENT_KEY = 'motion-follow-recent';
const RECENT_MAX = 5;
const PULSE_MS = 1600;
const RECENTER_MS = 250;
const INITIAL_EASE_MS = 900;

let selection = null; // { fleetId, id, mode, lost, lostSince, item, zoom }
const listeners = new Set();
let hooks = {
  ensureVisible: () => {},
  toast: () => {},
  fleetLabel: (fleetId) => fleetId,
};

let unsubscribeUpdate = null;
let loopFrame = null;
let lostTimer = null;
let pendingTimer = null;
let pendingPoll = null;
let cameraSuspended = false; // rider is mid-zoom; don't fight the gesture
let suspendedAt = 0;
let programmaticUntil = 0; // our own easeTo is running
let lastCentered = null;
let lastPosition = null;
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

const pollMs = (fleetId) => CONFIG.FOLLOW_POLL_MS[fleetId] ?? CONFIG.VEHICLE_POLL_MS;

// ---- public API ---------------------------------------------------------------

export const getSelection = () => selection;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function follow(fleetId, id, { mode = 'following' } = {}) {
  if (selection && selection.fleetId === fleetId && selection.id === id) {
    setMode(mode);
    return;
  }
  detach();
  selection = { fleetId, id, mode, lost: false, lostSince: 0, item: null, zoom: null };
  const fleet = getFleet(fleetId);
  if (fleet?.has(id)) attach(fleet);
  else waitForVehicle(fleetId, id, mode);
  schedulePermalinkUpdate();
  emit();
}

export function unfollow(reason = 'user') {
  if (!selection) return;
  const { fleetId, id } = selection;
  detach();
  selection = null;
  setSelectedFeature(null);
  schedulePermalinkUpdate();
  emit({ reason, fleetId, id });
}

export function setMode(mode) {
  if (!selection || selection.mode === 'pending' || selection.mode === mode) return;
  selection.mode = mode;
  if (mode === 'following') lockCamera();
  emit();
}

export function getRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// `nextHooks`: { ensureVisible(group, dataStatus), toast(message), fleetLabel(fleetId) }
export function initFollow(nextHooks = {}) {
  hooks = { ...hooks, ...nextHooks };
  onCameraTakeover((reason) => {
    if (!selection || selection.mode === 'pending') return;
    if (reason === 'region') {
      unfollow('region');
      hooks.toast('Stopped following: geography changed');
    } else if (selection.mode === 'following') {
      setMode('selected');
    }
  });
  map.on('dragstart', onGestureStart);
  map.on('rotatestart', onGestureStart);
  map.on('pitchstart', onGestureStart);
  // MapLibre's scroll-zoom events carry no originalEvent, so zoom intent is
  // read from the raw inputs instead.
  map.on('zoomstart', onZoomStart);
  map.on('wheel', suspendForZoom);
  map.on('dblclick', suspendForZoom);
  map.on('touchstart', (event) => {
    if (event.originalEvent?.touches?.length >= 2) suspendForZoom();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !selection) return;
    if (event.target.closest?.('input, textarea, select')) return;
    unfollow('user');
  });
  reducedMotion?.addEventListener?.('change', () => emit());
  window.__follow = { getSelection, follow, unfollow, setMode };
}

// ---- attach / detach ------------------------------------------------------------

function attach(fleet) {
  clearPending();
  const item = fleet.getItem(selection.id);
  selection.item = item;
  selection.lost = false;
  if (selection.mode === 'pending') selection.mode = 'following';
  fleet.setGlide(selection.id, Math.round(pollMs(fleet.id) * CONFIG.FOLLOW_GLIDE_FACTOR));
  unsubscribeUpdate = fleet.onUpdate(onFleetUpdate);
  hooks.ensureVisible(item.props.group, item.props.dataStatus);
  rememberRecent(fleet.id, item);
  lastPosition = fleet.getDisplayed(selection.id) ?? [item.lng, item.lat];
  if (selection.mode === 'following') lockCamera();
  startLoop();
}

function detach() {
  clearPending();
  clearTimeout(lostTimer);
  lostTimer = null;
  unsubscribeUpdate?.();
  unsubscribeUpdate = null;
  if (selection) getFleet(selection.fleetId)?.setGlide(selection.id, null);
  cancelAnimationFrame(loopFrame);
  loopFrame = null;
  cameraSuspended = false;
  lastCentered = null;
  lastPosition = null;
}

// A shared link can name a vehicle before its feed has loaded (or before the
// fleet exists at all). Check once a second until it appears or we time out.
function waitForVehicle(fleetId, id, mode) {
  selection.mode = 'pending';
  selection.requestedMode = mode;
  const timeout = Math.min(
    Math.max(pollMs(fleetId) * 3, CONFIG.FOLLOW_RESTORE_MIN_MS),
    CONFIG.FOLLOW_RESTORE_MAX_MS,
  );
  pendingPoll = setInterval(() => {
    const fleet = getFleet(fleetId);
    if (!fleet?.has(id)) return;
    selection.mode = selection.requestedMode ?? 'following';
    attach(fleet);
    emit();
  }, 1000);
  pendingTimer = setTimeout(() => {
    const label = hooks.fleetLabel(fleetId);
    unfollow('timeout');
    hooks.toast(`Couldn't find that ${label}. It may have finished its trip, or it isn't tracked in this geography.`);
  }, timeout);
}

function clearPending() {
  clearInterval(pendingPoll);
  clearTimeout(pendingTimer);
  pendingPoll = null;
  pendingTimer = null;
}

// ---- feed updates -----------------------------------------------------------------

function onFleetUpdate() {
  if (!selection) return;
  const fleet = getFleet(selection.fleetId);
  const item = fleet?.getItem(selection.id);
  if (item) {
    selection.item = item;
    if (selection.lost) {
      selection.lost = false;
      clearTimeout(lostTimer);
      lostTimer = null;
    }
    emit();
    return;
  }
  if (selection.lost) return;
  selection.lost = true;
  selection.lostSince = Date.now();
  const grace = Math.min(
    pollMs(selection.fleetId) * CONFIG.FOLLOW_LOST_GRACE_POLLS,
    CONFIG.FOLLOW_LOST_MAX_MS,
  );
  lostTimer = setTimeout(() => {
    unfollow('lost');
    hooks.toast('Stopped following: the vehicle left the live feed (trip ended or out of range).');
  }, grace);
  emit();
}

// ---- camera -------------------------------------------------------------------------

function followPadding() {
  const padding = { ...fitPadding() };
  const card = document.getElementById('trip-card');
  const cardHeight = card && !card.hidden ? card.offsetHeight : 0;
  if (window.innerWidth <= 760) {
    padding.bottom = Math.max(padding.bottom, cardHeight + 24);
  } else if (card && !card.hidden) {
    padding.right = Math.max(padding.right, card.offsetWidth + 40);
  }
  return padding;
}

function targetZoom() {
  const group = selection.item?.props.group;
  const minimum = CONFIG.FOLLOW_MIN_ZOOM[group] ?? CONFIG.FOLLOW_MIN_ZOOM.default;
  return Math.max(map.getZoom(), selection.zoom ?? minimum);
}

function lockCamera() {
  const center = lastPosition ?? (selection.item ? [selection.item.lng, selection.item.lat] : null);
  if (!center) return;
  cameraSuspended = false;
  const options = { center, zoom: targetZoom(), padding: followPadding() };
  if (reducedMotion?.matches) {
    map.jumpTo(options);
  } else {
    programmaticUntil = performance.now() + INITIAL_EASE_MS + 50;
    map.easeTo({ ...options, duration: INITIAL_EASE_MS, essential: true });
  }
  lastCentered = center;
}

function onGestureStart(event) {
  if (!event.originalEvent || selection?.mode !== 'following') return;
  if (event.originalEvent.touches?.length >= 2) {
    suspendForZoom(); // two-finger pinch starts as a drag; treat as zoom
    return;
  }
  setMode('selected');
}

function onZoomStart(event) {
  if (event.originalEvent) suspendForZoom(); // +/- buttons, keyboard
}

function suspendForZoom() {
  if (selection?.mode !== 'following') return;
  cameraSuspended = true;
  suspendedAt = performance.now();
}

// Called from the frame loop once the rider's zoom has settled.
function resumeAfterZoom() {
  cameraSuspended = false;
  selection.zoom = map.getZoom();
  if (!lastPosition) return;
  // Wheel zoom anchors on the cursor and drifts the vehicle off center;
  // slide it back rather than snapping.
  programmaticUntil = performance.now() + RECENTER_MS + 50;
  map.easeTo({ center: lastPosition, duration: reducedMotion?.matches ? 0 : RECENTER_MS });
  lastCentered = lastPosition;
}

// ---- per-frame loop -------------------------------------------------------------------
// Moves the ring with the vehicle's interpolated position, pulses it, and
// (while locked) recenters the camera. One tiny GeoJSON source per frame.

function startLoop() {
  cancelAnimationFrame(loopFrame);
  const step = (now) => {
    loopFrame = requestAnimationFrame(step);
    if (!selection || selection.mode === 'pending') return;
    const fleet = getFleet(selection.fleetId);
    const position = (!selection.lost && fleet?.getDisplayed(selection.id)) || lastPosition;
    if (!position) return;
    lastPosition = position;
    const pulse = reducedMotion?.matches || selection.lost ? 0.15 : (now % PULSE_MS) / PULSE_MS;
    setSelectedFeature(position, {
      color: selection.item?.props.color,
      stale: selection.lost || selection.item?.props.stale,
      pulse,
    });
    if (selection.mode !== 'following' || document.hidden) return;
    if (cameraSuspended) {
      if (map.isMoving() || now - suspendedAt < 300) return;
      resumeAfterZoom();
      return;
    }
    if (now < programmaticUntil || map.isMoving()) return;
    if (lastCentered && lastCentered[0] === position[0] && lastCentered[1] === position[1]) return;
    map.setCenter(position);
    lastCentered = position;
  };
  loopFrame = requestAnimationFrame(step);
}

// ---- misc --------------------------------------------------------------------------------

function rememberRecent(fleetId, item) {
  try {
    const key = `${fleetId}:${item.id}`;
    const entry = {
      key,
      fleetId,
      id: item.id,
      title: item.props.title,
      subtitle: item.props.dest || '',
      color: item.props.color,
      at: Date.now(),
    };
    const list = [entry, ...getRecent().filter((recent) => recent.key !== key)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: recents are a convenience */
  }
}

function emit(event = null) {
  listeners.forEach((fn) => fn(selection, event));
}
