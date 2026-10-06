import { describe, expect, it } from 'vitest';
import { GLYPHS, iconName, parseIconName } from './glyphs.js';

describe('glyphs', () => {
  it('has a path builder for every vehicle shape', () => {
    expect(Object.keys(GLYPHS).sort()).toEqual(['boat', 'bus', 'dock', 'plane', 'share-bike', 'share-scooter']);
    for (const draw of Object.values(GLYPHS)) expect(typeof draw).toBe('function');
  });

  it('traces a path on a canvas-like context', () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k) => () => { calls.push(String(k)); } });
    for (const draw of Object.values(GLYPHS)) draw(ctx as unknown as CanvasRenderingContext2D, 64);
    expect(calls.filter((c) => c === 'beginPath')).toHaveLength(6);
  });

  it('round-trips sprite names', () => {
    expect(iconName('bus', '#F2B84B')).toBe('icon-bus-f2b84b');
    expect(parseIconName('icon-bus-f2b84b')).toEqual({ shape: 'bus', color: '#f2b84b' });
    expect(parseIconName('icon-share-scooter-69D277')).toEqual({ shape: 'share-scooter', color: '#69d277' });
  });

  it('rejects names that are not vehicle sprites', () => {
    expect(parseIconName('nav-chevron')).toBeNull();
    expect(parseIconName('icon-tram-f2b84b')).toBeNull();
    expect(parseIconName('icon-bus-zzzzzz')).toBeNull();
    expect(parseIconName('icon-bus-')).toBeNull();
  });
});
