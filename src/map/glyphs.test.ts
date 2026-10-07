import { describe, expect, it } from 'vitest';
import { GLYPHS, glyphSvgPath, iconName, parseIconName } from './glyphs.js';

describe('glyphs', () => {
  it('has a path builder for every vehicle shape', () => {
    expect(Object.keys(GLYPHS).sort()).toEqual(['boat', 'bus', 'dock', 'plane', 'plane-heli', 'plane-light', 'plane-other', 'share-bike', 'share-scooter', 'station', 'train']);
    for (const draw of Object.values(GLYPHS)) expect(typeof draw).toBe('function');
  });

  it('traces a path on a canvas-like context', () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k) => () => { calls.push(String(k)); } });
    for (const draw of Object.values(GLYPHS)) draw(ctx as unknown as CanvasRenderingContext2D, 64);
    expect(calls.filter((c) => c === 'beginPath')).toHaveLength(11);
  });

  it('gives an SVG path for the polygon and box shapes', () => {
    expect(glyphSvgPath('plane')).toMatch(/^M32 2L35 8.*Z$/);
    expect(glyphSvgPath('boat')).toMatch(/^M32 2L45 14.*Z$/);
    expect(glyphSvgPath('bus')).toMatch(/^M30 8H34A9 9 0 0 1 43 17V47.*Z$/);
    expect(glyphSvgPath('train')).toBe('M22 3H42V25H22ZM22 39H42V61H22Z');
    expect(glyphSvgPath('station')).toBe('M18 18H46V46H18Z');
    expect(glyphSvgPath('dock')).toMatch(/^M23 15H41/);
    expect(glyphSvgPath('train')).not.toBe(glyphSvgPath('bus'));
    expect(glyphSvgPath('nope')).toBe('');
  });

  it('round-trips sprite names', () => {
    expect(iconName('bus', '#F2B84B')).toBe('icon-bus-f2b84b');
    expect(parseIconName('icon-bus-f2b84b')).toEqual({ shape: 'bus', color: '#f2b84b' });
    expect(parseIconName('icon-share-scooter-69D277')).toEqual({ shape: 'share-scooter', color: '#69d277' });
    expect(parseIconName('icon-train-80276c')).toEqual({ shape: 'train', color: '#80276c' });
    expect(parseIconName('icon-station-da291c')).toEqual({ shape: 'station', color: '#da291c' });
  });

  it('rejects names that are not vehicle sprites', () => {
    expect(parseIconName('nav-chevron')).toBeNull();
    expect(parseIconName('icon-tram-f2b84b')).toBeNull();
    expect(parseIconName('icon-bus-zzzzzz')).toBeNull();
    expect(parseIconName('icon-bus-')).toBeNull();
  });
});
