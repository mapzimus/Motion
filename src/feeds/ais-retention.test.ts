import { describe, expect, it } from 'vitest';
import { ageText } from './age.js';
import { isMoored, isStaleVessel, pruneAfterMs, shouldPruneVessel, snapshotQuietSince } from './ais-retention.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-10-05T18:00:00Z');

// A live-frame record: silence starts when it was heard.
const live = (ageMs: number, sog: number) => ({ at: NOW - ageMs, quietSince: NOW - ageMs, sog });

describe('AIS retention', () => {
  it('treats under 1 knot as moored and unknown speed as moving', () => {
    expect(isMoored(0)).toBe(true);
    expect(isMoored(0.9)).toBe(true);
    expect(isMoored(1)).toBe(false);
    expect(isMoored(NaN)).toBe(false);
    expect(pruneAfterMs(0.2)).toBe(60 * MIN);
    expect(pruneAfterMs(7.5)).toBe(15 * MIN);
    expect(pruneAfterMs(NaN)).toBe(15 * MIN);
  });

  it('drops moving vessels after 15 minutes and moored vessels after 60', () => {
    expect(shouldPruneVessel(live(14 * MIN, 7.5), NOW)).toBe(false);
    expect(shouldPruneVessel(live(16 * MIN, 7.5), NOW)).toBe(true);
    expect(shouldPruneVessel(live(16 * MIN, NaN), NOW)).toBe(true);
    expect(shouldPruneVessel(live(59 * MIN, 0.3), NOW)).toBe(false);
    expect(shouldPruneVessel(live(61 * MIN, 0.3), NOW)).toBe(true);
  });

  it('keeps an hours-old snapshot vessel dimmed while its listening silence is short', () => {
    const heardAt = NOW - 3 * HOUR;
    const vessel = { at: heardAt, quietSince: snapshotQuietSince(heardAt, 10 * MIN, NOW), sog: 7.5 };
    expect(vessel.quietSince).toBe(NOW - 10 * MIN);
    expect(shouldPruneVessel(vessel, NOW)).toBe(false);
    expect(isStaleVessel(vessel, NOW)).toBe(true);
    // Six more minutes of listening make 16: dropped.
    expect(shouldPruneVessel(vessel, NOW + 6 * MIN)).toBe(true);
  });

  it('always drops positions older than 6 hours', () => {
    const vessel = { at: NOW - 6 * HOUR - MIN, quietSince: NOW, sog: 0 };
    expect(shouldPruneVessel(vessel, NOW)).toBe(true);
  });

  it('falls back to real age when the gateway sends no listening time', () => {
    expect(snapshotQuietSince(NOW - 20 * MIN, NaN, NOW)).toBe(NOW - 20 * MIN);
    // Listening silence can never start before the boat was heard.
    expect(snapshotQuietSince(NOW - 5 * MIN, 30 * MIN, NOW)).toBe(NOW - 5 * MIN);
  });

  it('formats ages in seconds, minutes and hours', () => {
    expect(ageText(45_000)).toBe('45s');
    expect(ageText(12 * MIN)).toBe('12 min');
    expect(ageText(2 * HOUR + 5 * MIN)).toBe('2 h 5 min');
    expect(ageText(6 * HOUR)).toBe('6 h');
    expect(ageText(-5_000)).toBe('0s');
  });
});
