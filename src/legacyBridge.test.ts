import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initLegacyBridge } from './legacyBridge.js';
import { setFatal, setLoading, setScheduledCounts } from './stores/index.js';

const overlay = () => document.getElementById('overlay')!;
const text = (id: string) => document.getElementById(id)!.textContent;

beforeAll(() => {
  document.body.innerHTML = `
    <div id="overlay"><div id="overlay-text"></div></div>
    <span id="status-dot"></span><span id="status-text"></span>
    <b id="stat-live"></b><b id="stat-routes"></b><b id="stat-stations"></b><b id="stat-reference"></b>
    <span id="alerts-count"></span><ul id="alerts-list"></ul>`;
  // Boot starts the bridge as soon as the panel exists; a second call (the
  // failure path in main.tsx) must be harmless.
  initLegacyBridge();
  initLegacyBridge();
});

describe('legacy bridge started before the map is ready', () => {
  it('shows the current loading message straight away', () => {
    expect(text('overlay-text')).toBe('Loading New England…');
  });

  it('fills the panel from store changes without lifting the overlay', () => {
    setScheduledCounts({ red: 3, bus: 4 });
    expect(text('stat-routes')).toBe('7');
    expect(overlay().classList.contains('hidden')).toBe(false);
  });

  it('follows loading messages and lifts the overlay on null', () => {
    setLoading('Drawing the map…');
    expect(text('overlay-text')).toBe('Drawing the map…');
    expect(overlay().classList.contains('hidden')).toBe(false);
    setLoading(null);
    expect(overlay().classList.contains('hidden')).toBe(true);
  });

  it('brings the overlay back with the error on a fatal failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setFatal(new Error('503'));
    expect(overlay().classList.contains('hidden')).toBe(false);
    expect(overlay().classList.contains('fatal')).toBe(true);
    expect(text('overlay-text')).toContain('503');
  });
});
