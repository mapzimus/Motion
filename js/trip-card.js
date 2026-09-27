// Trip card + toast DOM for follow mode. Subscribes to follow.js and renders
// tripCardData(). This is the only follow-mode module that touches the page;
// the Preact rewrite replaces it with a component.

import { getSelection, setMode, subscribe, unfollow } from './follow.js';
import { buildPermalinkHash } from './permalink.js';
import { createTripWatcher, fleetLabel, tripCardData } from './trip-data.js';

let el = {};
let extras = null;
let watcher = null;
let toastTimer = null;
let lastKey = null;

const text = (node, value) => {
  node.textContent = value ?? '';
  node.hidden = !value;
};

function relativeAge(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `updated ${seconds}s ago`;
  return `updated ${Math.round(seconds / 60)} min ago`;
}

export function showToast(message, ms = 5000) {
  if (!el.toast) return;
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function badge(label, className = '') {
  const node = document.createElement('span');
  node.className = `trip-badge ${className}`.trim();
  node.textContent = label;
  return node;
}

function renderFoot(card) {
  el.foot.replaceChildren();
  const parts = [card.provider, relativeAge(card.updatedAt)].filter(Boolean).join(' · ');
  el.foot.append(parts);
  if (card.sourceUrl) {
    const link = document.createElement('a');
    link.href = card.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Source ↗';
    el.foot.append(' · ', link);
  }
}

function render(selection) {
  if (!selection) {
    el.card.hidden = true;
    document.body.classList.remove('trip-open');
    return;
  }
  el.card.hidden = false;
  document.body.classList.add('trip-open');

  if (selection.mode === 'pending' || !selection.item) {
    el.card.dataset.mode = 'pending';
    el.swatch.style.background = 'var(--text-faint)';
    text(el.title, `Looking for ${fleetLabel(selection.fleetId)} ${selection.id}…`);
    text(el.headsign, 'Waiting for its live feed to report in.');
    el.badges.replaceChildren();
    text(el.status, '');
    el.stops.replaceChildren();
    el.stops.hidden = true;
    text(el.note, '');
    text(el.meta, '');
    el.actions.hidden = true;
    el.foot.replaceChildren();
    return;
  }

  const card = tripCardData(selection.fleetId, selection.item, extras);
  el.card.dataset.mode = selection.mode;
  el.card.classList.toggle('lost', selection.lost);
  el.card.style.setProperty('--trip-color', card.color || '#8a939c');
  el.swatch.style.background = card.color || '#8a939c';
  text(el.title, card.title);
  text(el.headsign, card.headsign);

  el.badges.replaceChildren();
  if (card.badge) el.badges.append(badge(card.badge, 'number'));
  el.badges.append(badge(card.dataStatus, `status ${card.dataStatus}`));
  if (selection.lost) el.badges.append(badge('Signal lost · waiting', 'warn'));
  else if (card.stale) el.badges.append(badge('Position is old', 'warn'));
  el.badges.hidden = false;

  text(el.status, card.status);

  el.stops.replaceChildren();
  for (const stop of card.stops ?? []) {
    const row = document.createElement('li');
    row.className = 'trip-stop';
    const name = document.createElement('span');
    name.className = 'trip-stop-name';
    name.textContent = stop.name;
    const when = document.createElement('span');
    when.className = 'trip-stop-when';
    const eta = document.createElement('strong');
    eta.textContent = stop.eta;
    when.append(eta);
    if (stop.clock) when.append(document.createTextNode(` ${stop.clock}`));
    row.append(name, when);
    if (stop.delay) {
      const delay = document.createElement('span');
      delay.className = `trip-stop-delay${stop.late ? ' late' : ''}`;
      delay.textContent = stop.delay;
      row.append(delay);
    }
    el.stops.append(row);
  }
  el.stops.hidden = !card.stops?.length;
  text(el.note, card.stopsNote);
  text(el.meta, card.meta);

  el.actions.hidden = false;
  const following = selection.mode === 'following';
  el.follow.textContent = following ? 'Following' : 'Follow';
  el.follow.setAttribute('aria-pressed', String(following));
  el.follow.classList.toggle('on', following);
  renderFoot(card);
}

function onSelection(selection, event) {
  const key = selection ? `${selection.fleetId}:${selection.id}` : null;
  if (key !== lastKey) {
    lastKey = key;
    extras = null;
    if (!selection) watcher.stop();
  }
  if (selection?.item) watcher.set(selection.fleetId, selection.item);
  render(selection);
  if (!selection && event?.reason === 'user') el.toast.hidden = true;
}

async function copyLink() {
  const url = new URL(window.location.href);
  url.hash = buildPermalinkHash();
  try {
    await navigator.clipboard.writeText(url.href);
    showToast('Link copied. It opens locked onto this vehicle.', 3000);
  } catch {
    window.prompt('Copy this link:', url.href);
  }
}

export function initTripCard() {
  const card = document.getElementById('trip-card');
  if (!card) return;
  el = {
    card,
    swatch: card.querySelector('.trip-swatch'),
    title: card.querySelector('.trip-title'),
    headsign: card.querySelector('.trip-headsign'),
    badges: card.querySelector('.trip-badges'),
    status: card.querySelector('.trip-status'),
    stops: card.querySelector('.trip-stops'),
    note: card.querySelector('.trip-note'),
    meta: card.querySelector('.trip-meta'),
    actions: card.querySelector('.trip-actions'),
    follow: card.querySelector('.trip-follow'),
    share: card.querySelector('.trip-share'),
    foot: card.querySelector('.trip-foot'),
    close: card.querySelector('.trip-close'),
    toast: document.getElementById('toast'),
  };
  watcher = createTripWatcher((next) => {
    extras = next;
    render(getSelection());
  });
  el.close.addEventListener('click', () => unfollow('user'));
  el.follow.addEventListener('click', () => {
    const selection = getSelection();
    if (!selection) return;
    setMode(selection.mode === 'following' ? 'selected' : 'following');
  });
  el.share.addEventListener('click', copyLink);
  subscribe(onSelection);
  // Relative ages and ETAs drift; refresh the card once a second while open.
  setInterval(() => {
    if (!document.hidden && getSelection()?.item) render(getSelection());
  }, 1000);
}

